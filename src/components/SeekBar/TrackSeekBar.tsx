import { useEffect, useRef, useState } from 'react'
import { Section, AppMode } from '../../types'
import { engine, getCurrentManifest } from '../../multiplay/bridge'

interface Props {
  currentTime: number
  duration: number
  sections: Section[]
  mode: AppMode
  activeSectionId: string | null
  onSeek: (time: number) => void
  onSectionUpdate: (id: string, updates: Partial<Section>) => void
  onSectionLabelClick: (id: string) => void
}

const LABEL_W = 64
const STRIP_H = 22
const LANE_H = 30
const MIN_VIEW_H = STRIP_H + LANE_H
const maxViewH = () => Math.round(window.innerHeight * 0.72)

/**
 * MultiPlay 用シークバー。RecPlay の SeekBar の場所に置き、
 * 段（レーン）をトラック別に分け、上段に区間（マーカー）の帯を出す。
 * 編集モードでは帯の左端をドラッグしてマーカー位置を動かせる。
 */
export function TrackSeekBar({ currentTime, duration, sections, mode, activeSectionId, onSeek, onSectionUpdate, onSectionLabelClick }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const drawKeyRef = useRef('')
  // レーン = 曲データ（manifest）のトラックが土台。デコード済みのトラックはエンジン側の
  // 実ピーク・実長を使い、未着のトラックは曲データに保存されたピークで先行表示する。
  const manifest = getCurrentManifest()
  const baseTracks = manifest?.tracks ?? []
  const defs = baseTracks.length ? baseTracks : engine.tracks.map(t => ({ id: t.def.id, name: t.def.name, offsetMs: t.def.offsetMs }))
  const lanes = defs.map(def => {
    const eng = engine.tracks.find(t => t.def.id === def.id)
    if (eng) return { id: def.id, name: def.name, peaks: eng.peaks, offsetMs: eng.def.offsetMs ?? 0, dur: eng.buffer.duration }
    const mt = baseTracks.find(t => t.id === def.id)
    return { id: def.id, name: def.name, peaks: mt?.peaks ?? [], offsetMs: mt?.offsetMs ?? def.offsetMs ?? 0, dur: mt?.durationSec ?? 0 }
  })
  const sorted = [...sections].sort((a, b) => a.startTime - b.startTime)
  const endOf = (i: number) => (i + 1 < sorted.length ? sorted[i + 1].startTime : duration)
  const safeDur = Math.max(duration, 0.001)

  useEffect(() => {
    const key = `${lanes.length}|${duration}|${lanes.map(l => `${l.peaks.length}:${l.dur}`).join(',')}`
    if (drawKeyRef.current === key) return
    drawKeyRef.current = key
    lanes.forEach((lane, i) => {
      const cv = canvasRefs.current[i]
      if (!cv || duration <= 0) return
      const W = 1000, H = LANE_H
      cv.width = W; cv.height = H
      const g = cv.getContext('2d')
      if (!g) return
      g.clearRect(0, 0, W, H)
      if (!lane.peaks.length || lane.dur <= 0) return
      const off = lane.offsetMs / 1000
      const x0 = (off / duration) * W
      const w = Math.max(2, (lane.dur / duration) * W)
      g.fillStyle = '#63e6a4'
      g.globalAlpha = 0.8
      const n = lane.peaks.length
      for (let b = 0; b < n; b++) {
        const x = x0 + (b / n) * w
        const h = Math.max(1, lane.peaks[b] * (H - 8))
        g.fillRect(x, (H - h) / 2, Math.max(1, w / n - 0.5), h)
      }
      g.globalAlpha = 1
    })
  })

  const fracFromClientX = (clientX: number) => {
    const el = wrapRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const w = rect.width - LABEL_W
    return Math.max(0, Math.min(1, w > 0 ? (clientX - rect.left - LABEL_W) / w : 0))
  }

  const scrubRef = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (duration <= 0) return
    scrubRef.current = true
    onSeek(fracFromClientX(e.clientX) * duration)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (scrubRef.current) onSeek(fracFromClientX(e.clientX) * duration)
  }
  const endScrub = () => { scrubRef.current = false }

  const onFlagPointerDown = (e: React.PointerEvent, sec: Section, idx: number) => {
    if (mode !== 'edit' || duration <= 0) return
    e.stopPropagation()
    const move = (ev: PointerEvent) => {
      const prev = idx > 0 ? sorted[idx - 1].startTime + 0.1 : 0
      const next = idx + 1 < sorted.length ? sorted[idx + 1].startTime - 0.1 : duration - 0.1
      const t = Math.max(prev, Math.min(next, fracFromClientX(ev.clientX) * duration))
      onSectionUpdate(sec.id, { startTime: Math.round(t * 100) / 100 })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const playFrac = duration > 0 ? currentTime / duration : 0

  // ── 境界ドラッグ（RecPlay のシークバー高さ調整を移植） ──
  const contentH = STRIP_H + lanes.length * LANE_H
  const [viewH, setViewH] = useState<number | null>(null)
  const effH = viewH ?? Math.min(contentH, Math.round(window.innerHeight * 0.45))
  const resizeDrag = useRef<{ startY: number; startH: number } | null>(null)
  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeDrag.current = { startY: e.clientY, startH: effH }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const handleResizeMove = (e: React.PointerEvent) => {
    if (!resizeDrag.current) return
    e.preventDefault()
    const dy = e.clientY - resizeDrag.current.startY
    setViewH(Math.max(MIN_VIEW_H, Math.min(maxViewH(), resizeDrag.current.startH + dy)))
  }
  const handleResizeEnd = () => { resizeDrag.current = null }

  return (
    <div className="seekbar-container tseek">
      <div className="tseek-scroll" style={{ height: effH }}>
      <div
        className="tseek-body"
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endScrub}
        style={{ height: contentH }}
      >
        {/* 区間（マーカー）の帯 */}
        <div className="tseek-stripbands" style={{ left: LABEL_W, height: STRIP_H }}>
          {sorted.map((sec, i) => (
            <div
              key={sec.id}
              className={`tseek-band${sec.id === activeSectionId ? ' active' : ''}`}
              style={{
                left: `${(sec.startTime / safeDur) * 100}%`,
                width: `${((endOf(i) - sec.startTime) / safeDur) * 100}%`,
                background: `${sec.color}30`,
                borderLeft: `2px solid ${sec.color}`,
              }}
              onPointerDown={(e) => onFlagPointerDown(e, sec, i)}
            >
              <button
                className="tseek-bandlabel"
                style={{ color: sec.color }}
                onClick={(e) => { e.stopPropagation(); onSectionLabelClick(sec.id) }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {sec.label}
              </button>
            </div>
          ))}
          <div className="tseek-playhead" style={{ left: `${playFrac * 100}%` }} />
        </div>

        {/* トラック名ラベル */}
        {lanes.map((lane, i) => (
          <span key={lane.id} className="tseek-lanelabel" style={{ top: STRIP_H + i * LANE_H, height: LANE_H, width: LABEL_W }}>
            {lane.name}
          </span>
        ))}

        {/* 波形レーン */}
        <div className="tseek-canvascol" style={{ marginLeft: LABEL_W, top: STRIP_H }}>
          {lanes.map((lane, i) => (
            <canvas key={lane.id} ref={el => { canvasRefs.current[i] = el }} className="tseek-canvas" style={{ height: LANE_H }} />
          ))}
          <div className="tseek-playhead" style={{ left: `${playFrac * 100}%` }} />
        </div>
      </div>
      </div>
      <div className="seekbar-resize-handle">
        <button
          className="resize-extreme-btn"
          onClick={() => setViewH(MIN_VIEW_H)}
          title="波形エリアを最小にする"
        >▼ 最小</button>
        <div
          className="resize-drag-zone"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          title="ドラッグで波形エリアの高さを調整"
        />
        <button
          className="resize-extreme-btn"
          onClick={() => setViewH(Math.min(contentH, maxViewH()))}
          title="波形エリアを全トラック分まで広げる"
        >▲ 最大</button>
      </div>
    </div>
  )
}
