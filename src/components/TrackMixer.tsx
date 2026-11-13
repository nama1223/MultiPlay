import { useEffect, useState } from 'react'
import { engine, setCurrentMix } from '../multiplay/bridge'
import { songUrl } from '../config'
import type { MixState } from '../audio-engine'
import type { MpSongManifest } from '../multiplay/types'

const THIRD = 1 / 3

/**
 * トラック別ミキサー（縦型フェーダー形式）。
 * トラックごとの縦カラム: 上=名前、中=縦スライダー、下=%表示と M / 1/3 / S ボタン。
 * 横に収まらない場合はカラム列が横スクロールする。
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
      {open && (
        <div className="track-mixer-body">
          {manifest.tracks.map(t => {
            const m = mix[t.id] ?? { volume: 1, mute: false, solo: false }
            const isThird = Math.abs(m.volume - THIRD) < 0.02
            return (
              <div key={t.id} className="mix-col">
                <span className="mix-name" title={t.name}>{t.name}</span>
                <input
                  type="range" min={0} max={150} value={Math.round(m.volume * 100)}
                  onChange={e => set(t.id, { volume: Number(e.target.value) / 100 })}
                  className="mix-vol" aria-label={`${t.name} の音量`}
                />
                <span className="mix-val">{Math.round(m.volume * 100)}%</span>
                <div className="mix-btns">
                  <button className={`mix-btn${m.mute ? ' on-mute' : ''}`} onClick={() => set(t.id, { mute: !m.mute })} title="ミュート">M</button>
                  <button className={`mix-btn${isThird ? ' on-third' : ''}`} onClick={() => set(t.id, { volume: THIRD })} title="音量を1/3にする">1/3</button>
                  <button className={`mix-btn${m.solo ? ' on-solo' : ''}`} onClick={() => set(t.id, { solo: !m.solo })} title="ソロ">S</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
