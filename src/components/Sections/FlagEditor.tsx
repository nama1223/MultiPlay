import { useEffect, useRef, useState } from 'react'
import { Section } from '../../types'
import { formatTime } from '../../utils/timeFormat'

/**
 * 時刻入力枠への「スクロール＆スワイプ」付け足し。
 * - ホイール: 1ノッチ = 0.1秒（符号だけ見るのでトラックパッドでも暴走しない）
 * - 横ドラッグ: 5px = 0.1秒。ポインターキャプチャで枠外へ出ても追い続け、
 *   CSS の touch-action: none と合わせてページのスクロール/パンと競合させない。
 * どちらも呼び出し側の adjust（= 既存のクランプ＋onUpdate 経路）にデルタを渡すだけ。
 * タップだけなら従来どおりフォーカスして打てる（ドラッグ判定は移動が始まってから）。
 */
function useTimeScrub(adjust: (delta: number) => void) {
  const ref = useRef<HTMLInputElement>(null)
  const adjustRef = useRef(adjust)
  adjustRef.current = adjust
  const drag = useRef<{ lastX: number; rest: number } | null>(null)

  // ホイールは React の onWheel だと passive で preventDefault できないため native で付ける
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      adjustRef.current(e.deltaY < 0 ? 0.1 : -0.1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const pointerHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLInputElement>) => {
      if (e.button !== 0) return
      drag.current = { lastX: e.clientX, rest: 0 }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent<HTMLInputElement>) => {
      const d = drag.current
      if (!d) return
      const total = d.rest + (e.clientX - d.lastX)
      const steps = Math.trunc(total / 5)
      if (steps !== 0) {
        adjustRef.current(steps * 0.1)
        d.rest = total - steps * 5
        d.lastX = e.clientX
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLInputElement>) => {
      drag.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    },
    onPointerCancel: () => { drag.current = null },
  }
  return { ref, pointerHandlers }
}

interface Props {
  section: Section
  duration: number
  editAdjustValues: number[]
  onUpdate: (id: string, updates: Partial<Section>) => void
  onPlay: (start: number, end: number) => void
  /** マーカー（開始点だけ）として編集する */
  markerMode?: boolean
}

/** マーカーの編集UI（編集モードで展開した行の中に出す） */
export function FlagEditor({ section, duration, editAdjustValues, onUpdate, onPlay, markerMode }: Props) {
  const [startInput, setStartInput] = useState(String(section.startTime.toFixed(1)))
  const [endInput, setEndInput] = useState(String(section.endTime.toFixed(1)))

  // マーカーモードでは開始位置は [0, 曲の尺] だけに制限し、隣のマーカーの追い越しを許可する
  const clampStart = (v: number) =>
    markerMode
      ? Math.max(0, duration > 0 ? Math.min(v, duration) : v)
      : Math.max(0, Math.min(v, section.endTime - 0.1))

  const applyStart = (val: string) => {
    const n = parseFloat(val)
    if (!isNaN(n)) onUpdate(section.id, { startTime: clampStart(n) })
  }

  const applyEnd = (val: string) => {
    const n = parseFloat(val)
    if (!isNaN(n)) onUpdate(section.id, { endTime: Math.min(duration, Math.max(n, section.startTime + 0.1)) })
  }

  const adjustStart = (delta: number) => {
    const newVal = clampStart(section.startTime + delta)
    onUpdate(section.id, { startTime: newVal })
    setStartInput(newVal.toFixed(1))
  }

  const adjustEnd = (delta: number) => {
    const newVal = Math.min(duration, Math.max(section.endTime + delta, section.startTime + 0.1))
    onUpdate(section.id, { endTime: newVal })
    setEndInput(newVal.toFixed(1))
  }

  const adjLabel = (v: number) => (v > 0 ? `+${v}` : `${v}`)

  // 開始・終了どちらの入力枠にもスクロール＆スワイプを付ける
  const startScrub = useTimeScrub(adjustStart)
  const endScrub = useTimeScrub(adjustEnd)

  return (
    <div className="flag-editor">
      <div className="flag-editor-header">
        <span style={{ color: section.color }}>●</span>
        <span className="flag-editor-name">{section.label}</span>
        <button
          className="flag-play-btn"
          onClick={() => onPlay(section.startTime, section.endTime)}
          title="このマーカーから再生"
        >▶ 再生</button>
        {!markerMode && (
        <button
          className="flag-play-btn"
          onClick={() => onPlay(Math.max(section.startTime, section.endTime - 3), section.endTime)}
          title="終了位置の直前3秒を再生"
        >▶ ラスト3秒</button>
        )}
      </div>

      <div className="flag-editor-row">
        <span className="flag-editor-label">開始</span>
        <input
          ref={startScrub.ref}
          {...startScrub.pointerHandlers}
          className="time-input"
          type="number"
          step="0.1"
          value={startInput}
          onChange={(e) => setStartInput(e.target.value)}
          onBlur={(e) => applyStart(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyStart(startInput)}
        />
        <span className="flag-editor-fmt">{formatTime(section.startTime)}</span>
      </div>
      <div className="adjust-btns">
        {editAdjustValues.map((v) => (
          <button key={v} className="adj-btn" onClick={() => adjustStart(v)}>
            {adjLabel(v)}
          </button>
        ))}
      </div>

      {!markerMode && (<>
      <div className="flag-editor-row">
        <span className="flag-editor-label">終了</span>
        <input
          ref={endScrub.ref}
          {...endScrub.pointerHandlers}
          className="time-input"
          type="number"
          step="0.1"
          value={endInput}
          onChange={(e) => setEndInput(e.target.value)}
          onBlur={(e) => applyEnd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyEnd(endInput)}
        />
        <span className="flag-editor-fmt">{formatTime(section.endTime)}</span>
      </div>
      <div className="adjust-btns">
        {editAdjustValues.map((v) => (
          <button key={v} className="adj-btn" onClick={() => adjustEnd(v)}>
            {adjLabel(v)}
          </button>
        ))}
      </div>
      </>)}
    </div>
  )
}
