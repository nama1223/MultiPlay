import { useEffect, useState } from 'react'
import { indexUrl } from '../config'
import { OrgInfo } from '../hooks/useOrgAuth'
import { fetchIndexFresh, saveIndex, saveSongManifest } from '../multiplay/api'
import type { MpIndex, MpSongManifest, MpSongSummary } from '../multiplay/types'

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

interface Props {
  org: OrgInfo
  onFileSelect: (url: string, key: string, name: string) => void
  onRename?: (oldKey: string, newKey: string, newName: string) => void
  onLogout: () => void
  isAdmin?: boolean
}

/**
 * 団体の曲一覧。RecPlay の FileListPage の構成（ヘッダー＋カード一覧）をそのまま使い、
 * 中身を MultiPlay の曲（多重録音）に差し替えたもの。
 */
export function FileListPage({ org, onFileSelect, onLogout, isAdmin = false }: Props) {
  const [songs, setSongs] = useState<MpSongSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [createMsg, setCreateMsg] = useState('')

  const createSong = async () => {
    const title = newTitle.trim()
    if (!title || creating) return
    setCreating(true)
    setCreateMsg('')
    try {
      const m: MpSongManifest = { id: newId('s'), title, groupId: org.id, groupName: org.name, tracks: [], markers: [] }
      await saveSongManifest(m)
      const idx = await fetchIndexFresh()
      await saveIndex({ groups: idx.groups.map(g => g.id === org.id ? { ...g, songs: [...g.songs, { id: m.id, title: m.title, trackCount: 0 }] } : g) })
      // 作った曲をそのままプレイヤーで開く（トラック追加は「編集」モードで）
      onFileSelect(m.id, m.id, m.title)
    } catch (e) {
      setCreateMsg(e instanceof Error ? e.message : String(e))
      setCreating(false)
    }
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`${indexUrl()}${indexUrl().includes('?') ? '&' : '?'}v=${Date.now()}`, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j: MpIndex) => {
        if (!alive) return
        const g = j.groups.find(x => x.id === org.id)
        setSongs(g?.songs ?? [])
        setLoading(false)
      })
      .catch(e => { if (alive) { setError(`曲の一覧を取得できませんでした（${e.message}）`); setLoading(false) } })
    return () => { alive = false }
  }, [org.id])

  return (
    <div className="file-list-page">
      <header className="app-header">
        <span className="app-title">🎵 {org.name}</span>
        <button className="change-btn" onClick={onLogout}>← 戻る</button>
      </header>

      <div className="file-list-body">
        {loading && <p className="hint-text">読み込み中...</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && songs.length === 0 && (
          <p className="no-sections">まだ曲がありません</p>
        )}
        <div className="file-items">
          {songs.map(s => (
            <button key={s.id} className="file-item-btn" onClick={() => onFileSelect(s.id, s.id, s.title)}>
              <span className="file-item-name">🎵 {s.title}</span>
              {typeof s.trackCount === 'number' && (
                <span className="file-item-meta">{s.trackCount} トラック</span>
              )}
            </button>
          ))}
        </div>

        {isAdmin && (
          <div className="file-create">
            <div className="file-create-title">＋ 新しい曲を作成（管理者）</div>
            <div className="mp-admin-row">
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="新しい曲のタイトル"
                className="mp-input grow"
              />
              <button className="mp-btn" disabled={creating || !newTitle.trim()} onClick={createSong}>
                {creating ? '作成中…' : '曲を作成'}
              </button>
            </div>
            <p className="file-create-note">作成するとそのままプレイヤーが開きます。トラックの追加は「編集」モードの「曲データの編集」から。</p>
            {createMsg && <p className="error-text">{createMsg}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
