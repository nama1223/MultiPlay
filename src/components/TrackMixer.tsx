import { useEffect, useState } from 'react'
import { engine, setCurrentMix } from '../multiplay/bridge'
import { songUrl } from '../config'
import type { MixState } from '../audio-engine'
import type { MpSongManifest } from '../multiplay/types'

/**
 * トラック別ミキサー。RecPlay の区間リストと同じ行レイアウトで、
 * 各トラックの音量・ミュート・ソロを操作する。
 */
export function TrackMixer({ songId }: { songId: string }) {
  const [manifest, setManifest] = useState<MpSongManifest | null>(null)
  const [mix, setMix] = useState<Record<string, MixState>>({})
  const [open, setOpen] = useState(() => localStorage.getItem('mp_mixer_open') !== '0')
  const toggleOpen = () => setOpen(v => {
    localStorage.setItem('mp_mixer_open', v ? '0' : '1')
    return !v
  })

  useEffect(() => {
    let alive = true
    setManifest(null)
    fetch(songUrl(songId))
      .then(r => (r.ok ? r.json() : null))
      .then((m: MpSongManifest | null) => {
        if (!alive || !m) return
        setManifest(m)
        const initial: Record<string, MixState> = {}
        for (const t of m.tracks) initial[t.id] = { volume: 1, mute: false, solo: false }
        setMix(initial)
        engine.applyMix(initial)
      })
      .catch(() => { /* 表示だけの部品なので失敗時は無言 */ })
    return () => { alive = false }
  }, [songId])

  useEffect(() => { engine.applyMix(mix); setCurrentMix(mix) }, [mix])

  if (!manifest || manifest.tracks.length === 0) return null

  const set = (id: string, patch: Partial<MixState>) =>
    setMix(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  return (
    <div className="track-mixer">
      <button className="track-mixer-head" onClick={toggleOpen} aria-expanded={open}>
        <span className="track-mixer-title">トラック音量</span>
        <span className="track-mixer-chevron">{open ? '▲ 畳む' : '▼ 開く'}</span>
      </button>
      {open && manifest.tracks.map(t => {
        const m = mix[t.id] ?? { volume: 1, mute: false, solo: false }
        return (
          <div key={t.id} className="track-row">
            <span className="track-name">{t.name}</span>
            <button className={`track-ms${m.mute ? ' on-mute' : ''}`} onClick={() => set(t.id, { mute: !m.mute })}>M</button>
            <button className={`track-ms${m.solo ? ' on-solo' : ''}`} onClick={() => set(t.id, { solo: !m.solo })}>S</button>
            <input
              type="range" min={0} max={150} value={Math.round(m.volume * 100)}
              onChange={e => set(t.id, { volume: Number(e.target.value) / 100 })}
              className="track-vol" aria-label={`${t.name} の音量`}
            />
            <span className="track-vol-val">{Math.round(m.volume * 100)}%</span>
          </div>
        )
      })}
    </div>
  )
}
