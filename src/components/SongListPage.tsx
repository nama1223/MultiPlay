import { useEffect, useState } from 'react'
import { indexUrl } from '../config'
import type { MpIndex } from '../types-multiplay'

export function SongListPage({ onSelect }: { onSelect: (songId: string) => void }) {
  const [index, setIndex] = useState<MpIndex | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(indexUrl())
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j: MpIndex) => { if (alive) setIndex(j) })
      .catch(e => { if (alive) setError(`曲の一覧を取得できませんでした（${e.message}）`) })
    return () => { alive = false }
  }, [])

  if (error) return <div className="mp-msg mp-error">{error}</div>
  if (!index) return <div className="mp-msg">読み込み中…</div>

  return (
    <div className="mp-list">
      {index.groups.map(g => (
        <section key={g.id} className="mp-group">
          <h2 className="mp-group-name">{g.name}</h2>
          {g.songs.length === 0 && <p className="mp-empty">まだ曲がありません</p>}
          {g.songs.map(s => (
            <button key={s.id} className="mp-song-row" onClick={() => onSelect(s.id)}>
              <span className="mp-song-title">{s.title}</span>
              {typeof s.trackCount === 'number' && <span className="mp-song-meta">{s.trackCount} トラック</span>}
              <span className="mp-song-arrow">›</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
