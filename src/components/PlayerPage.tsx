import { useEffect, useRef, useState } from 'react'
import { songUrl, resolveTrackUrl } from '../config'
import { MultiTrackEngine, type MixState } from '../audio/engine'
import type { MpSongManifest } from '../types-multiplay'

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function Waveform({ peaks, offsetSec, trackDur, totalDur, color }: {
  peaks: number[]; offsetSec: number; trackDur: number; totalDur: number; color: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || totalDur <= 0) return
    const W = 960, H = 64
    cv.width = W; cv.height = H
    const g = cv.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, W, H)
    const x0 = (offsetSec / totalDur) * W
    const w = Math.max(2, (trackDur / totalDur) * W)
    g.fillStyle = color
    const n = peaks.length
    for (let i = 0; i < n; i++) {
      const x = x0 + (i / n) * w
      const h = Math.max(1, peaks[i] * (H - 4))
      g.fillRect(x, (H - h) / 2, Math.max(1, w / n - 0.5), h)
    }
  }, [peaks, offsetSec, trackDur, totalDur, color])
  return <canvas ref={ref} className="mp-wave" />
}

export function PlayerPage({ songId, onBack }: { songId: string; onBack: () => void }) {
  const engineRef = useRef<MultiTrackEngine | null>(null)
  if (!engineRef.current) engineRef.current = new MultiTrackEngine()
  const engine = engineRef.current

  const [manifest, setManifest] = useState<MpSongManifest | null>(null)
  const [status, setStatus] = useState('読み込み中…')
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [mix, setMix] = useState<Record<string, MixState>>({})
  const [reverb, setReverbState] = useState(0)
  const [rendering, setRendering] = useState(false)
  const mixRef = useRef(mix)
  mixRef.current = mix

  // 検証用フック（画面操作の自動テストから書き出し結果を確認するため）
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>
    w.__mpEngine = engine
    w.__mpRender = async () => {
      const blob = await engine.renderMixdown(mixRef.current)
      return { size: blob.size, type: blob.type }
    }
  }, [engine])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(songUrl(songId))
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const m = (await r.json()) as MpSongManifest
        if (!alive) return
        setManifest(m)
        const initial: Record<string, MixState> = {}
        for (const t of m.tracks) initial[t.id] = { volume: 1, mute: false, solo: false }
        setMix(initial)
        await engine.load(m.tracks, resolveTrackUrl, (done, total) => {
          if (alive) setStatus(`音声を読み込み中… ${done}/${total}`)
        })
        if (!alive) return
        engine.applyMix(initial)
        setReady(true)
        setStatus('')
      } catch (e) {
        if (alive) setStatus(`読み込みに失敗しました（${e instanceof Error ? e.message : e}）`)
      }
    })()
    return () => { alive = false; engine.dispose() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId])

  useEffect(() => {
    const id = setInterval(() => {
      setPos(engine.position())
      setPlaying(engine.playing)
    }, 100)
    return () => clearInterval(id)
  }, [engine])

  useEffect(() => { if (ready) engine.applyMix(mix) }, [mix, ready, engine])

  const duration = engine.duration

  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ready || duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    engine.seek(frac * duration)
    setPos(engine.position())
  }

  const playFromMarker = (time: number) => {
    engine.seek(time)
    if (!engine.playing) engine.play(time)
    setPlaying(true)
  }

  const skipBy = (sec: number) => {
    engine.seek(engine.position() + sec)
    setPos(engine.position())
  }

  const activeMarker = manifest
    ? manifest.markers.reduce((acc, mk, i) => (pos >= mk.time - 0.05 ? i : acc), -1)
    : -1

  const setTrackMix = (id: string, patch: Partial<MixState>) =>
    setMix(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const setReverb = (pct: number) => {
    setReverbState(pct)
    engine.setReverb(pct / 100)
  }

  const downloadMix = async () => {
    if (rendering || !ready) return
    setRendering(true)
    try {
      const blob = await engine.renderMixdown(mix)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${manifest.title}_mix.wav`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } finally {
      setRendering(false)
    }
  }

  if (!manifest) return (
    <div className="mp-player">
      <div className="mp-filebar">
        <button className="mp-orglink" onClick={onBack}>曲一覧へ</button>
      </div>
      <div className="mp-msg">{status}</div>
    </div>
  )

  return (
    <div className="mp-player">
      <div className="mp-filebar">
        <button className="mp-orglink" onClick={onBack} title="曲一覧へ">{manifest.groupName ?? '曲一覧'}</button>
        <span className="mp-time"><span className="mp-cur">{fmt(pos)}</span><span className="mp-sep">/</span><span className="mp-total">{fmt(duration)}</span></span>
      </div>
      <div className="mp-filebar sub">
        <span className="mp-filename">{manifest.title}</span>
      </div>
      {status && <div className="mp-msg">{status}</div>}

      <div className="mp-tracks">
        {manifest.tracks.map(t => {
          const lt = engine.tracks.find(x => x.def.id === t.id)
          const m = mix[t.id] ?? { volume: 1, mute: false, solo: false }
          const offsetSec = (t.offsetMs ?? 0) / 1000
          return (
            <div key={t.id} className="mp-track">
              <div className="mp-track-head">
                <span className="mp-track-name">{t.name}</span>
                <button className={`mp-ms ${m.mute ? 'on-mute' : ''}`} onClick={() => setTrackMix(t.id, { mute: !m.mute })}>M</button>
                <button className={`mp-ms ${m.solo ? 'on-solo' : ''}`} onClick={() => setTrackMix(t.id, { solo: !m.solo })}>S</button>
                <input
                  type="range" min={0} max={150} value={Math.round(m.volume * 100)}
                  onChange={e => setTrackMix(t.id, { volume: Number(e.target.value) / 100 })}
                  className="mp-vol" aria-label={`${t.name} の音量`}
                />
                <span className="mp-vol-val">{Math.round(m.volume * 100)}%</span>
              </div>
              <div className="mp-wave-wrap" onClick={seekFromEvent}>
                {lt && <Waveform peaks={lt.peaks} offsetSec={offsetSec} trackDur={lt.buffer.duration} totalDur={duration} color="#3fd68c" />}
                <span className="mp-playhead" style={{ left: duration > 0 ? `${(pos / duration) * 100}%` : '0%' }} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="mp-controls">
        <button className="mp-skip" disabled={!ready} onClick={() => skipBy(-10)}>-10s</button>
        <button
          className="mp-play"
          disabled={!ready}
          onClick={() => { setPlaying(engine.toggle()); setPos(engine.position()) }}
          aria-label={playing ? '一時停止' : '再生'}
        >{playing ? '⏸' : '▶'}</button>
        <button className="mp-skip" disabled={!ready} onClick={() => skipBy(10)}>+10s</button>
      </div>

      <div className="mp-subcontrols">
        <label className="mp-reverb">
          リバーブ
          <input type="range" min={0} max={100} value={reverb} onChange={e => setReverb(Number(e.target.value))} aria-label="リバーブ量" />
          <span className="mp-vol-val">{reverb}%</span>
        </label>
        <button className="mp-download" disabled={!ready || rendering} onClick={downloadMix}>
          {rendering ? '書き出し中…' : '⬇ このバランスでダウンロード'}
        </button>
      </div>

      {manifest.markers.length > 0 && (
        <div className="mp-sections">
          {manifest.markers.map((mk, i) => (
            <button
              key={i}
              className={`mp-sectionrow ${i === activeMarker ? 'active' : ''}`}
              onClick={() => playFromMarker(mk.time)}
            >
              <span className="mp-section-label">{mk.label}</span>
              <span className="mp-section-time">{fmt(mk.time)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
