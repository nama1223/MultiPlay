import { useEffect, useState } from 'react'
import { indexUrl } from '../config'
import { OrgInfo } from '../hooks/useOrgAuth'
import type { MpIndex, MpSongSummary } from '../multiplay/types'

interface Props {
  org: OrgInfo
  onFileSelect: (url: string, key: string, name: string) => void
  onRename?: (oldKey: string, newKey: string, newName: string) => void
  onLogout: () => void
}

/**
 * 団体の曲一覧。RecPlay の FileListPage の構成（ヘッダー＋カード一覧）をそのまま使い、
 * 中身を MultiPlay の曲（多重録音）に差し替えたもの。
 */
export function FileListPage({ org, onFileSelect, onLogout }: Props) {
  const [songs, setSongs] = useState<MpSongSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
      </div>
    </div>
  )
}
