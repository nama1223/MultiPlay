import { useEffect, useRef, useState } from 'react'
import { engine, setCurrentMix, loadPersonalMix, storePersonalMix } from '../multiplay/bridge'
import { songUrl } from '../config'
import type { MixState } from '../audio-engine'
import type { MpSongManifest } from '../multiplay/types'

const THIRD = 1 / 3

/**
 * トラック別ミキサー（縦型フェーダー形式）。
 * カラム構成: [名前][縦スライダー][%表示][M][1/3] の行＋その下に [Solo]（カラム幅いっぱい）。
 * 「1/3」はトグル式: 押すと元の音量を覚えて33%にし、もう一度押すと元の音量に戻る。
 * %表示をタップすると数値入力に切り替わり、スライダーのダブルタップで100%に戻る。
 * 横に収まらない場合はカラム列が横スクロールする。
 * 音量・ミュート・ソロは「個人ミックス」として曲ごとにこの端末へ保存され（bridge.ts）、
 * モード切替でこの部品がアンマウントされても、同じ曲を再び開いても失われない。
 * マニフェストの gain とは別概念で、サーバーには上げない。
 */
export function TrackMixer({ songId }: { songId: string }) {
  const [manifest, setManifest] = useState<MpSongManifest | null>(null)
  const [mix, setMix] = useState<Record<string, MixState>>({})
  const [open, setOpen] = useState(() => localStorage.getItem('mp_mixer_open') !== '0')
  const [thirdMem, setThirdMem] = useState<Record<string, number>>({})
  const [editVal, setEditVal] = useState<{ id: string; text: string } | null>(null)
  const escRef = useRef(false)
  // ダブルタップ検出（スライダー操作のドラッグと区別するため、短時間・小移動のタップだけ数える）
  const tapRef = useRef<Record<string, { downAt: number; downX: number; downY: number; lastTapAt: number }>>({})
  const toggleOpen = () => setOpen(v => {
    localStorage.setItem('mp_mixer_open', v ? '0' : '1')
    return !v
  })

  useEffect(() => {
    let alive = true
    setManifest(null)
    setThirdMem({})
    setEditVal(null)
    fetch(songUrl(songId))
      .then(r => (r.ok ? r.json() : null))
      .then((m: MpSongManifest | null) => {
        if (!alive || !m) return
        setManifest(m)
        // 個人ミックス（この端末に保存済み）を土台に、現行トラック分だけを初期値にする。
        // 新しく増えたトラックは 100%、消えたトラックの分は捨てる。
        const saved = loadPersonalMix(songId)
        const initial: Record<string, MixState> = {}
        for (const t of m.tracks) initial[t.id] = saved[t.id] ?? { volume: 1, mute: false, solo: false }
        setMix(initial)
        storePersonalMix(songId, initial)
        engine.applyMix(initial)
      })
      .catch(() => { /* 表示だけの部品なので失敗時は無言 */ })
    return () => { alive = false }
  }, [songId])

  useEffect(() => { engine.applyMix(mix); setCurrentMix(mix) }, [mix])

  if (!manifest || manifest.tracks.length === 0) return null

  const set = (id: string, patch: Partial<MixState>) => {
    const next = { ...mix, [id]: { ...mix[id], ...patch } }
    setMix(next)
    storePersonalMix(songId, next)
  }

  /** 手動で音量を変えたら 1/3 トグルの復帰先は無効になる */
  const forgetThird = (id: string) =>
    setThirdMem(prev => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })

  const setVolumeManual = (id: string, volume: number) => {
    forgetThird(id)
    set(id, { volume })
  }

  const toggleThird = (id: string) => {
    const cur = mix[id]?.volume ?? 1
    if (id in thirdMem) {
      const back = thirdMem[id]
      forgetThird(id)
      set(id, { volume: back })
    } else {
      setThirdMem(prev => ({ ...prev, [id]: cur }))
      set(id, { volume: THIRD })
    }
  }

  const onSliderPointerDown = (id: string, e: React.PointerEvent) => {
    const rec = tapRef.current[id] ?? { downAt: 0, downX: 0, downY: 0, lastTapAt: 0 }
    rec.downAt = Date.now(); rec.downX = e.clientX; rec.downY = e.clientY
    tapRef.current[id] = rec
  }
  const onSliderPointerUp = (id: string, e: React.PointerEvent) => {
    const rec = tapRef.current[id]
    if (!rec) return
    const now = Date.now()
    const isTap = now - rec.downAt < 300 && Math.hypot(e.clientX - rec.downX, e.clientY - rec.downY) < 6
    if (!isTap) { rec.lastTapAt = 0; return }
    if (now - rec.lastTapAt < 350) {
      rec.lastTapAt = 0
      setVolumeManual(id, 1)
    } else {
      rec.lastTapAt = now
    }
  }

  const commitValEdit = (id: string) => {
    if (escRef.current) { escRef.current = false; setEditVal(null); return }
    if (!editVal || editVal.id !== id) return
    const n = parseFloat(editVal.text)
    if (!isNaN(n)) setVolumeManual(id, Math.max(0, Math.min(150, n)) / 100)
    setEditVal(null)
  }

  return (
    <div className="track-mixer">
      <button className="track-mixer-head" onClick={toggleOpen} aria-expanded={open}>
        <span className="track-mixer-title">トラック音量</span>
        <span className="head-state">{open ? '▼ 畳む' : '▲ 開く'}</span>
      </button>
      {open && (
        <div className="track-mixer-body">
          {/* スライダー操作のヒントを、カラム群の背面にうっすら表示する */}
          {/* ウォーターマークはタイル状に敷くが、全面だと邪魔なので縦の中央の帯
              （2〜4行目相当）だけに制限する。奇数行は半分ずらして段違いにする */}
          <div className="mix-watermark" aria-hidden="true">
            {[1, 2, 3].map((r) => (
              <div key={r} className={`mix-wm-row${r % 2 ? ' alt' : ''}`}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <span key={i}>ダブルタップで100％</span>
                ))}
              </div>
            ))}
          </div>
          {manifest.tracks.map(t => {
            const m = mix[t.id] ?? { volume: 1, mute: false, solo: false }
            const thirdOn = t.id in thirdMem
            const editing = editVal?.id === t.id
            return (
              <div key={t.id} className="mix-col">
                <span className="mix-name" title={t.name}>{t.name}</span>
                <input
                  type="range" min={0} max={150} value={Math.round(m.volume * 100)}
                  onChange={e => setVolumeManual(t.id, Number(e.target.value) / 100)}
                  onDoubleClick={() => setVolumeManual(t.id, 1)}
                  onPointerDown={e => onSliderPointerDown(t.id, e)}
                  onPointerUp={e => onSliderPointerUp(t.id, e)}
                  className="mix-vol" aria-label={`${t.name} の音量`}
                  title="ダブルタップで100%"
                />
                {editing ? (
                  <input
                    type="number" min={0} max={150} step={1}
                    className="mix-val-input"
                    value={editVal.text}
                    autoFocus
                    aria-label={`${t.name} の音量（%）`}
                    onChange={e => setEditVal({ id: t.id, text: e.target.value })}
                    onBlur={() => commitValEdit(t.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') { escRef.current = true; (e.target as HTMLInputElement).blur() }
                    }}
                  />
                ) : (
                  <button
                    className="mix-val"
                    title="タップで数値を直接入力"
                    onClick={() => { escRef.current = false; setEditVal({ id: t.id, text: String(Math.round(m.volume * 100)) }) }}
                  >{Math.round(m.volume * 100)}%</button>
                )}
                <div className="mix-btns">
                  <button className={`mix-btn${m.mute ? ' on-mute' : ''}`} onClick={() => set(t.id, { mute: !m.mute })} title="ミュート">M</button>
                  <button className={`mix-btn${thirdOn ? ' on-third' : ''}`} onClick={() => toggleThird(t.id)} title="音量を1/3にする（もう一度押すと元に戻る）">1/3</button>
                </div>
                <button className={`mix-solo${m.solo ? ' on-solo' : ''}`} onClick={() => set(t.id, { solo: !m.solo })} title="ソロ">Solo</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
