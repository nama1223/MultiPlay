import { useEffect, useRef, useState } from 'react'
import {
  getAdminToken, setAdminToken, clearAdminToken, checkToken,
  fetchIndexFresh, fetchSongFresh, uploadAudio, deleteAudioByUrl,
  saveSongManifest, saveIndex,
} from '../admin/api'
import type { MpIndex, MpSongManifest } from '../types-multiplay'

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

export function AdminPage({ onBack }: { onBack: () => void }) {
  const [authed, setAuthed] = useState(!!getAdminToken())
  const [pass, setPass] = useState('')
  const [index, setIndex] = useState<MpIndex | null>(null)
  const [groupId, setGroupId] = useState('')
  const [song, setSong] = useState<MpSongManifest | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [newSongTitle, setNewSongTitle] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadIndex = async () => {
    const idx = await fetchIndexFresh()
    setIndex(idx)
    if (!groupId && idx.groups.length) setGroupId(idx.groups[0].id)
  }

  useEffect(() => {
    if (authed) loadIndex().catch(e => setMsg(String(e.message ?? e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  const tryLogin = async () => {
    setAdminToken(pass)
    setBusy(true)
    try {
      if (await checkToken()) { setAuthed(true); setMsg('') }
      else { clearAdminToken(); setMsg('合言葉が違うようです') }
    } catch { clearAdminToken(); setMsg('確認できませんでした（通信エラー）') }
    setBusy(false)
  }

  if (!authed) return (
    <div className="mp-admin">
      <button className="mp-back" onClick={onBack}>‹ 曲一覧へ</button>
      <h2 className="mp-title">管理画面</h2>
      <p className="mp-subtitle">管理用の合言葉を入れてください（この端末のタブを閉じるまで保持されます）</p>
      <div className="mp-admin-row">
        <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="合言葉" className="mp-input" autoComplete="off" />
        <button className="mp-btn" disabled={busy || !pass} onClick={tryLogin}>入る</button>
      </div>
      {msg && <p className="mp-error">{msg}</p>}
    </div>
  )

  const group = index?.groups.find(g => g.id === groupId)

  const persistIndex = async (idx: MpIndex) => { setIndex(idx); await saveIndex(idx) }

  const addGroup = async () => {
    if (!index || !newGroupName.trim()) return
    setBusy(true)
    try {
      const g = { id: newId('g'), name: newGroupName.trim(), songs: [] }
      await persistIndex({ groups: [...index.groups, g] })
      setGroupId(g.id); setNewGroupName(''); setMsg('団体を追加しました')
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  const createSong = async () => {
    if (!index || !group || !newSongTitle.trim()) return
    setBusy(true)
    try {
      const m: MpSongManifest = { id: newId('s'), title: newSongTitle.trim(), groupId: group.id, groupName: group.name, tracks: [], markers: [] }
      await saveSongManifest(m)
      const idx: MpIndex = { groups: index.groups.map(g => g.id === group.id ? { ...g, songs: [...g.songs, { id: m.id, title: m.title, trackCount: 0 }] } : g) }
      await persistIndex(idx)
      setSong(m); setNewSongTitle(''); setMsg('曲を作成しました。トラックを追加してください')
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  const openSong = async (id: string) => {
    setBusy(true)
    try { setSong(await fetchSongFresh(id)); setMsg('') }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  const saveSong = async () => {
    if (!song || !index) return
    setBusy(true)
    try {
      await saveSongManifest(song)
      const idx: MpIndex = { groups: index.groups.map(g => g.id === song.groupId
        ? { ...g, songs: g.songs.map(s => s.id === song.id ? { id: song.id, title: song.title, trackCount: song.tracks.length } : s) }
        : g) }
      await persistIndex(idx)
      setMsg('保存しました')
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  const deleteSong = async () => {
    if (!song || !index) return
    if (!confirm(`「${song.title}」を削除しますか？（音声ファイルも消えます）`)) return
    setBusy(true)
    try {
      for (const t of song.tracks) await deleteAudioByUrl(t.url)
      const idx: MpIndex = { groups: index.groups.map(g => ({ ...g, songs: g.songs.filter(s => s.id !== song.id) })) }
      await persistIndex(idx)
      setSong(null); setMsg('曲を削除しました')
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  const addTrackFile = async (file: File) => {
    if (!song) return
    setBusy(true)
    try {
      const url = await uploadAudio(song.id, file)
      const name = file.name.replace(/\.[^.]+$/, '')
      setSong({ ...song, tracks: [...song.tracks, { id: newId('t'), name, url, offsetMs: 0, gain: 1 }] })
      setMsg(`「${file.name}」をアップロードしました（まだ保存はされていません）`)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  return (
    <div className="mp-admin">
      <button className="mp-back" onClick={onBack}>‹ 曲一覧へ</button>
      <h2 className="mp-title">管理画面</h2>
      {msg && <p className="mp-admin-msg">{msg}</p>}
      {!index && <p className="mp-msg">読み込み中…</p>}
      {index && !song && (
        <>
          <div className="mp-admin-row">
            <label>団体
              <select value={groupId} onChange={e => setGroupId(e.target.value)} className="mp-input">
                {index.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          </div>
          <div className="mp-admin-row">
            <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="新しい団体名" className="mp-input" />
            <button className="mp-btn" disabled={busy || !newGroupName.trim()} onClick={addGroup}>団体を追加</button>
          </div>
          {group && (
            <>
              <h3 className="mp-admin-h">{group.name} の曲</h3>
              {group.songs.map(s => (
                <button key={s.id} className="mp-song-row" onClick={() => openSong(s.id)}>
                  <span className="mp-song-title">{s.title}</span>
                  {typeof s.trackCount === 'number' && <span className="mp-song-meta">{s.trackCount} トラック</span>}
                  <span className="mp-song-arrow">›</span>
                </button>
              ))}
              <div className="mp-admin-row">
                <input value={newSongTitle} onChange={e => setNewSongTitle(e.target.value)} placeholder="新しい曲のタイトル" className="mp-input" />
                <button className="mp-btn" disabled={busy || !newSongTitle.trim()} onClick={createSong}>曲を作成</button>
              </div>
            </>
          )}
        </>
      )}

      {index && song && (
        <>
          <div className="mp-admin-row">
            <button className="mp-btn sub" onClick={() => setSong(null)}>‹ 曲の選択へ戻る</button>
          </div>
          <div className="mp-admin-row">
            <label>タイトル <input value={song.title} onChange={e => setSong({ ...song, title: e.target.value })} className="mp-input" /></label>
          </div>

          <h3 className="mp-admin-h">トラック</h3>
          {song.tracks.map(t => (
            <div key={t.id} className="mp-admin-track">
              <input value={t.name} onChange={e => setSong({ ...song, tracks: song.tracks.map(x => x.id === t.id ? { ...x, name: e.target.value } : x) })} className="mp-input grow" aria-label="トラック名" />
              <label className="mp-num">ずらし(ms)
                <input type="number" step={10} value={t.offsetMs ?? 0} onChange={e => setSong({ ...song, tracks: song.tracks.map(x => x.id === t.id ? { ...x, offsetMs: Number(e.target.value) } : x) })} className="mp-input small" />
              </label>
              <span className="mp-nudges">
                {[-100, -10, 10, 100].map(d => (
                  <button key={d} className="mp-btn sub tiny" onClick={() => setSong({ ...song, tracks: song.tracks.map(x => x.id === t.id ? { ...x, offsetMs: (x.offsetMs ?? 0) + d } : x) })}>{d > 0 ? `+${d}` : d}</button>
                ))}
              </span>
              <label className="mp-num">音量%
                <input type="number" min={0} max={200} value={Math.round((t.gain ?? 1) * 100)} onChange={e => setSong({ ...song, tracks: song.tracks.map(x => x.id === t.id ? { ...x, gain: Number(e.target.value) / 100 } : x) })} className="mp-input small" />
              </label>
              <button className="mp-btn danger" onClick={async () => { await deleteAudioByUrl(t.url); setSong({ ...song, tracks: song.tracks.filter(x => x.id !== t.id) }) }}>削除</button>
            </div>
          ))}
          <div className="mp-admin-row">
            <input ref={fileRef} type="file" accept="audio/*" className="mp-input" />
            <button className="mp-btn" disabled={busy} onClick={() => { const f = fileRef.current?.files?.[0]; if (f) addTrackFile(f) }}>トラックを追加（アップロード）</button>
          </div>

          <h3 className="mp-admin-h">練習マーカー</h3>
          {song.markers.map((mk, i) => (
            <div key={i} className="mp-admin-track">
              <input value={mk.label} onChange={e => setSong({ ...song, markers: song.markers.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} className="mp-input grow" aria-label="マーカー名" />
              <label className="mp-num">時刻(秒)
                <input type="number" step={0.1} min={0} value={mk.time} onChange={e => setSong({ ...song, markers: song.markers.map((x, j) => j === i ? { ...x, time: Number(e.target.value) } : x) })} className="mp-input small" />
              </label>
              <button className="mp-btn danger" onClick={() => setSong({ ...song, markers: song.markers.filter((_, j) => j !== i) })}>削除</button>
            </div>
          ))}
          <div className="mp-admin-row">
            <button className="mp-btn sub" onClick={() => setSong({ ...song, markers: [...song.markers, { time: 0, label: '練習' }].sort((a, b) => a.time - b.time) })}>マーカーを追加</button>
          </div>

          <div className="mp-admin-row sticky">
            <button className="mp-btn primary" disabled={busy} onClick={saveSong}>保存する</button>
            <button className="mp-btn danger" disabled={busy} onClick={deleteSong}>この曲を削除</button>
          </div>
        </>
      )}
    </div>
  )
}
