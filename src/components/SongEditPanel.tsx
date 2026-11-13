import { useEffect, useRef, useState } from 'react'
import {
  fetchIndexFresh, fetchSongFresh, uploadAudio, deleteAudioByUrl,
  saveSongManifest, saveIndex,
} from '../multiplay/api'
import { engine, getCurrentManifest } from '../multiplay/bridge'
import { computePeaks } from '../audio-engine'
import type { MpIndex, MpSongManifest } from '../multiplay/types'

const roundPeaks = (peaks: number[]) => peaks.map(v => Math.round(v * 1000) / 1000)

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

interface Props {
  songId: string
  onSaved: (newTitle: string) => void
  onDeleted: () => void
}

/**
 * 曲データの編集パネル（旧・管理画面の曲編集をプレイヤーの「編集」モードへ移したもの）。
 * 再生・波形・マーカー編集と同じ画面で、聴きながらトラック構成やずらしを調整できる。
 */
export function SongEditPanel({ songId, onSaved, onDeleted }: Props) {
  const [open, setOpen] = useState(false)
  const [song, setSong] = useState<MpSongManifest | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [armDelete, setArmDelete] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    const cur = getCurrentManifest()
    if (cur && cur.id === songId) { setSong(JSON.parse(JSON.stringify(cur)) as MpSongManifest); return }
    fetchSongFresh(songId)
      .then(m => { if (alive) setSong(m) })
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

  const saveSong = async () => {
    if (!song) return
    setBusy(true)
    try {
      // 波形ピークが無いトラックは、読み込み済みの音声から補完して保存する（先行表示用）
      const filled: MpSongManifest = {
        ...song,
        tracks: song.tracks.map(t => {
          if (t.peaks?.length) return t
          const eng = engine.tracks.find(x => x.def.id === t.id)
          return eng ? { ...t, peaks: roundPeaks(eng.peaks), durationSec: eng.buffer.duration } : t
        }),
      }
      setSong(filled)
      await saveSongManifest(filled)
      await persistIndexFor(filled)
      setMsg('保存しました（プレイヤーを読み込み直します）')
      onSaved(filled.title)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
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

  const addTrackFiles = async (files: File[]) => {
    if (!song || files.length === 0) return
    setBusy(true)
    try {
      const added: MpSongManifest['tracks'] = []
      for (const file of files) {
        const url = await uploadAudio(song.id, file)
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
        ? `${files.length} 件のトラックをアップロードしました（まだ保存はされていません）`
        : `「${files[0].name}」をアップロードしました（まだ保存はされていません）`)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  const onDropFiles = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name))
    if (files.length) void addTrackFiles(files)
  }

  return (
    <div className="song-edit">
      <button className="track-mixer-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="track-mixer-title">🎵 曲データの編集（タイトル・トラック構成）</span>
        <span className="track-mixer-chevron">{open ? '▲ 畳む' : '▼ 開く'}</span>
      </button>
      {open && (
        <div className="song-edit-body">
          {!song && <p className="mp-msg">読み込み中…</p>}
          {msg && <p className="mp-admin-msg">{msg}</p>}
          {song && (
            <>
              <div className="mp-admin-row">
                <label>タイトル <input value={song.title} onChange={e => setSong({ ...song, title: e.target.value })} className="mp-input" /></label>
              </div>

              <h3 className="mp-admin-h">トラック</h3>
              {song.tracks.map(t => (
                <div key={t.id} className="mp-admin-track oneline">
                  <input value={t.name} onChange={e => setSong({ ...song, tracks: song.tracks.map(x => x.id === t.id ? { ...x, name: e.target.value } : x) })} className="mp-input track-name-input" aria-label="トラック名" />
                  <label className="mp-num">ずらし
                    <input type="number" step={10} value={t.offsetMs ?? 0} onChange={e => setSong({ ...song, tracks: song.tracks.map(x => x.id === t.id ? { ...x, offsetMs: Number(e.target.value) } : x) })} className="mp-input offset-input" aria-label="ずらし（ミリ秒）" />
                    <span className="mp-unit">ms</span>
                  </label>
                  <span className="mp-nudges">
                    {[-100, -10, 10, 100].map(d => (
                      <button key={d} className="mp-btn sub tiny" onClick={() => setSong({ ...song, tracks: song.tracks.map(x => x.id === t.id ? { ...x, offsetMs: (x.offsetMs ?? 0) + d } : x) })}>{d > 0 ? `+${d}` : d}</button>
                    ))}
                  </span>
                  <button className="mp-btn danger" onClick={async () => { await deleteAudioByUrl(t.url); setSong({ ...song, tracks: song.tracks.filter(x => x.id !== t.id) }) }}>削除</button>
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

              <p className="mp-admin-note">ずらしは「保存する」を押すと確定します。保存するとプレイヤーが新しい構成で読み込み直します。</p>

              <div className="mp-admin-row">
                <button className="mp-btn primary" disabled={busy} onClick={saveSong}>保存する</button>
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
