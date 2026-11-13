import { useEffect, useRef, useState } from 'react'
import {
  fetchIndexFresh, fetchSongFresh, uploadAudio, deleteAudioByUrl,
  saveSongManifest, saveIndex,
} from '../multiplay/api'
import { engine, getCurrentManifest, setCurrentManifest, getCurrentMix } from '../multiplay/bridge'
import { computePeaks } from '../audio-engine'
import type { MpIndex, MpSongManifest } from '../multiplay/types'

const roundPeaks = (peaks: number[]) => peaks.map(v => Math.round(v * 1000) / 1000)

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

const SAVE_DEBOUNCE_MS = 1500
const TRACK_ROW_H = 40

interface Props {
  songId: string
  isPlaying: boolean
  /** 構成変更（トラック追加/削除/並べ替え/ずらし）をプレイヤーへ反映するためのリロード依頼 */
  onSaved: (newTitle: string) => void
  /** タイトルだけの保存完了通知（ヘッダ表示の追随用、リロードなし） */
  onTitleSaved: (newTitle: string) => void
  onDeleted: () => void
}

type SyncPhase = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/** プレイヤー（エンジン）へ再読み込みが必要な「構成」の署名 */
function structuralSig(m: MpSongManifest): string {
  return m.tracks.map(t => `${t.id}:${t.url}:${t.offsetMs ?? 0}`).join('|')
}
function engineSig(): string {
  return engine.tracks.map(t => `${t.def.id}:${t.def.url}:${t.def.offsetMs ?? 0}`).join('|')
}

/**
 * 曲データの編集パネル。変更はマーカーと同じ方式で自動保存する（デバウンス付き）。
 * 構成変更は停止中なら自動リロードで反映し、再生中は停止するまで保留する。
 */
export function SongEditPanel({ songId, isPlaying, onSaved, onTitleSaved, onDeleted }: Props) {
  const [open, setOpen] = useState(false)
  const [song, setSong] = useState<MpSongManifest | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [armDelete, setArmDelete] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [syncPhase, setSyncPhase] = useState<SyncPhase>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [pendingApply, setPendingApply] = useState(false)
  const [armTrackId, setArmTrackId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const songRef = useRef<MpSongManifest | null>(null)
  songRef.current = song
  const savedJsonRef = useRef<string>('')
  const loadedForRef = useRef<string>('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const saveAgainRef = useRef(false)
  const armTrackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved
  const onTitleSavedRef = useRef(onTitleSaved)
  onTitleSavedRef.current = onTitleSaved

  // ── 初期読み込み（パネルのローカル状態はここでだけ作る。以後のリロードで巻き戻さない） ──
  useEffect(() => {
    if (loadedForRef.current === songId) return
    loadedForRef.current = songId
    let alive = true
    const cur = getCurrentManifest()
    if (cur && cur.id === songId) {
      const clone = JSON.parse(JSON.stringify(cur)) as MpSongManifest
      savedJsonRef.current = JSON.stringify(clone)
      setSong(clone)
      return
    }
    fetchSongFresh(songId)
      .then(m => {
        if (!alive) return
        savedJsonRef.current = JSON.stringify(m)
        setSong(m)
      })
      .catch(e => { if (alive) setMsg(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [songId])

  const persistIndexFor = async (s: MpSongManifest) => {
    const idx = await fetchIndexFresh()
    const next: MpIndex = { groups: idx.groups.map(g => g.id === s.groupId
      ? { ...g, songs: g.songs.map(x => x.id === s.id ? { id: s.id, title: s.title, trackCount: s.tracks.length } : x) }
      : g) }
    await saveIndex(next)
  }

  /** 保存用ペイロード: 最新 manifest（マーカー等）を土台に、パネルのタイトルとトラックを載せる */
  const buildPayload = (s: MpSongManifest): MpSongManifest => {
    const latest = getCurrentManifest()
    const base = latest && latest.id === s.id ? latest : s
    const tracks = s.tracks.map(t => {
      if (t.peaks?.length) return t
      const eng = engine.tracks.find(x => x.def.id === t.id)
      return eng ? { ...t, peaks: roundPeaks(eng.peaks), durationSec: eng.buffer.duration } : t
    })
    return { ...base, title: s.title, tracks }
  }

  const doSave = async () => {
    if (savingRef.current) { saveAgainRef.current = true; return }
    const snapshot = songRef.current
    if (!snapshot) return
    if (JSON.stringify(snapshot) === savedJsonRef.current) return
    savingRef.current = true
    setSyncPhase('saving')
    try {
      const payload = buildPayload(snapshot)
      await saveSongManifest(payload)
      await persistIndexFor(payload)
      setCurrentManifest(payload)
      savedJsonRef.current = JSON.stringify(snapshot)
      setLastSavedAt(new Date())
      setSyncPhase('saved')
      setMsg('')
      onTitleSavedRef.current(payload.title)
      // gain はエンジンへ即時反映（ミキサーの現在バランスと合成して適用）
      for (const t of payload.tracks) {
        const eng = engine.tracks.find(x => x.def.id === t.id)
        if (eng) eng.def.gain = t.gain ?? 1
      }
      engine.applyMix(getCurrentMix())
      // 構成が変わっていればプレイヤーへ反映（再生中は停止まで保留）
      if (structuralSig(payload) !== engineSig()) {
        if (isPlayingRef.current) {
          setPendingApply(true)
        } else {
          setPendingApply(false)
          onSavedRef.current(payload.title)
        }
      } else {
        setPendingApply(false)
      }
    } catch (e) {
      setSyncPhase('error')
      setMsg(`自動保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    }
    savingRef.current = false
    // 保存中にさらに編集されていたら、間を置いてもう一度保存する
    if (saveAgainRef.current || (songRef.current && JSON.stringify(songRef.current) !== savedJsonRef.current)) {
      saveAgainRef.current = false
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => { void doSave() }, 400)
    }
  }
  const doSaveRef = useRef(doSave)
  doSaveRef.current = doSave

  // ── 変更をデバウンスして自動保存 ──
  useEffect(() => {
    if (!song) return
    if (JSON.stringify(song) === savedJsonRef.current) return
    setSyncPhase(prev => (prev === 'saving' ? prev : 'dirty'))
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { void doSaveRef.current() }, SAVE_DEBOUNCE_MS)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [song])

  // ── 再生が止まったら、保留していた構成変更を反映する ──
  const prevPlayingRef = useRef(isPlaying)
  useEffect(() => {
    const was = prevPlayingRef.current
    prevPlayingRef.current = isPlaying
    if (was && !isPlaying && pendingApply) {
      setPendingApply(false)
      const t = songRef.current?.title
      if (t) onSavedRef.current(t)
    }
  }, [isPlaying, pendingApply])

  const flushSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    void doSaveRef.current()
  }

  const deleteSong = async () => {
    if (!song) return
    if (!armDelete) { setArmDelete(true); return }
    setBusy(true)
    try {
      for (const t of song.tracks) await deleteAudioByUrl(t.url)
      const idx = await fetchIndexFresh()
      await saveIndex({ groups: idx.groups.map(g => ({ ...g, songs: g.songs.filter(s => s.id !== song.id) })) })
      onDeleted()
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  /** トラック削除は二度押し制（1回目は武装、数秒で解除） */
  const handleTrackDelete = async (t: MpSongManifest['tracks'][number]) => {
    if (armTrackId !== t.id) {
      setArmTrackId(t.id)
      if (armTrackTimerRef.current) clearTimeout(armTrackTimerRef.current)
      armTrackTimerRef.current = setTimeout(() => setArmTrackId(null), 3000)
      return
    }
    if (armTrackTimerRef.current) clearTimeout(armTrackTimerRef.current)
    setArmTrackId(null)
    await deleteAudioByUrl(t.url).catch(() => { /* ファイル掃除はベストエフォート */ })
    setSong(cur => (cur ? { ...cur, tracks: cur.tracks.filter(x => x.id !== t.id) } : cur))
  }

  /** ドラッグハンドルでの並べ替え（ポインタードラッグ、行高ぶんの移動で入れ替え） */
  const onHandlePointerDown = (e: React.PointerEvent, id: string, startIndex: number) => {
    e.preventDefault()
    setDraggingId(id)
    const startY = e.clientY
    const move = (ev: PointerEvent) => {
      const shift = Math.round((ev.clientY - startY) / TRACK_ROW_H)
      if (shift === 0) return
      setSong(cur => {
        if (!cur) return cur
        const from = cur.tracks.findIndex(t => t.id === id)
        if (from < 0) return cur
        const to = Math.max(0, Math.min(cur.tracks.length - 1, startIndex + shift))
        if (to === from) return cur
        const tracks = [...cur.tracks]
        const [moved] = tracks.splice(from, 1)
        tracks.splice(to, 0, moved)
        return { ...cur, tracks }
      })
    }
    const up = () => {
      setDraggingId(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const addTrackFiles = async (files: File[]) => {
    if (!songRef.current || files.length === 0) return
    const songIdAtStart = songRef.current.id
    setBusy(true)
    try {
      const added: MpSongManifest['tracks'] = []
      for (const file of files) {
        const url = await uploadAudio(songIdAtStart, file)
        const name = file.name.replace(/\.[^.]+$/, '')
        // 波形の先行表示用に、この場でピークと長さを計算して持たせる
        let peaks: number[] | undefined
        let durationSec: number | undefined
        try {
          const ab = await file.arrayBuffer()
          const ctx = new AudioContext()
          const buf = await ctx.decodeAudioData(ab)
          peaks = roundPeaks(computePeaks(buf))
          durationSec = buf.duration
          void ctx.close()
        } catch { /* 波形が作れなくてもアップロード自体は成立させる */ }
        added.push({ id: newId('t'), name, url, offsetMs: 0, gain: 1, peaks, durationSec })
      }
      setSong(cur => (cur ? { ...cur, tracks: [...cur.tracks, ...added] } : cur))
      setMsg(files.length > 1
        ? `${files.length} 件のトラックをアップロードしました`
        : `「${files[0].name}」をアップロードしました`)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  const onDropFiles = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name))
    if (files.length) void addTrackFiles(files)
  }

  const updateTrack = (id: string, patch: Partial<MpSongManifest['tracks'][number]>) =>
    setSong(cur => (cur ? { ...cur, tracks: cur.tracks.map(x => x.id === id ? { ...x, ...patch } : x) } : cur))

  const syncText = () => {
    if (syncPhase === 'saving') return '保存中…'
    if (syncPhase === 'error') return '保存に失敗しました'
    if (syncPhase === 'dirty') return '未保存の変更があります…'
    if (lastSavedAt) return `☁ ${lastSavedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 保存済み（自動）`
    return '自動保存が有効です'
  }

  return (
    <div className="song-edit">
      <button className="track-mixer-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="track-mixer-title">🎵 曲データの編集（タイトル・トラック構成）</span>
        <span className="head-state">{open ? '▲ 畳む' : '▼ 開く'}</span>
      </button>
      {open && (
        <div className="song-edit-body">
          {!song && <p className="mp-msg">読み込み中…</p>}
          {song && (
            <>
              <div className="sep-sync">
                <span className={`sep-sync-text${syncPhase === 'error' ? ' error' : ''}`}>{syncText()}</span>
                {pendingApply && <span className="sep-sync-pending">構成の反映は再生停止後</span>}
                <button className="mp-btn sub tiny" onClick={flushSave} disabled={syncPhase === 'saving'}>今すぐ保存</button>
              </div>
              {msg && <p className="mp-admin-msg">{msg}</p>}
              <div className="mp-admin-row">
                <label>タイトル <input value={song.title} onChange={e => setSong({ ...song, title: e.target.value })} className="mp-input" /></label>
              </div>

              <h3 className="mp-admin-h">トラック</h3>
              {song.tracks.map((t, i) => (
                <div key={t.id} className={`mp-admin-track oneline frameless${draggingId === t.id ? ' dragging' : ''}`}>
                  <span
                    className="sep-drag"
                    title="ドラッグで並べ替え"
                    onPointerDown={e => onHandlePointerDown(e, t.id, i)}
                  >⠿</span>
                  <input value={t.name} onChange={e => updateTrack(t.id, { name: e.target.value })} className="mp-input track-name-input" aria-label="トラック名" />
                  <label className="mp-num">ずらし
                    <input type="number" step={10} value={t.offsetMs ?? 0} onChange={e => updateTrack(t.id, { offsetMs: Number(e.target.value) })} className="mp-input offset-input" aria-label="ずらし（ミリ秒）" />
                    <span className="mp-unit">ms</span>
                  </label>
                  <span className="mp-nudges">
                    {[-100, -10, 10, 100].map(d => (
                      <button key={d} className="mp-btn sub tiny" onClick={() => updateTrack(t.id, { offsetMs: (t.offsetMs ?? 0) + d })}>{d > 0 ? `+${d}` : d}</button>
                    ))}
                  </span>
                  <button
                    className={`mp-btn danger track-del${armTrackId === t.id ? ' armed' : ''}`}
                    title={armTrackId === t.id ? 'もう一度押すと削除します' : 'トラックを削除'}
                    onClick={() => { void handleTrackDelete(t) }}
                  >{armTrackId === t.id ? '削除？' : '✕'}</button>
                </div>
              ))}
              <div
                className={`drop-zone${dragOver ? ' over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDropFiles}
              >
                <div className="drop-zone-text">ここに音声ファイルをドロップしてもトラックを追加できます（複数可）</div>
                <div className="mp-admin-row">
                  <input
                    ref={fileRef} type="file" accept="audio/*" multiple className="mp-input"
                    onChange={e => { const fs = e.target.files ? [...e.target.files] : []; if (fs.length) void addTrackFiles(fs); e.target.value = '' }}
                  />
                  <button className="mp-btn" disabled={busy} onClick={() => { const fs = fileRef.current?.files ? [...fileRef.current.files] : []; if (fs.length) void addTrackFiles(fs) }}>トラックを追加（アップロード）</button>
                </div>
              </div>

              <p className="mp-admin-note">変更は自動で保存されます。トラック構成やずらしは、停止中に自動でプレイヤーへ反映されます（再生中は停止後に反映）。</p>

              <div className="mp-admin-row">
                <button className="mp-btn danger" disabled={busy} onClick={deleteSong}>
                  {armDelete ? '本当にこの曲を削除しますか？（もう一度押すと実行）' : 'この曲を削除'}
                </button>
                {armDelete && <button className="mp-btn sub" onClick={() => setArmDelete(false)}>やめる</button>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
