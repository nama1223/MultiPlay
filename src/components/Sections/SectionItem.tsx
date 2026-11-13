import { useState } from 'react'
import { Section, AppMode } from '../../types'
import { formatTime } from '../../utils/timeFormat'

interface Props {
  section: Section
  mode: AppMode
  isActive: boolean
  onPlay: (start: number, end: number) => void
  onUpdate: (id: string, updates: Partial<Section>) => void
  onActivate: (id: string) => void
  /** ラベルタップ時はこちら（展開トグルを伴わない活性化） */
  onSelectOnly?: (id: string) => void
  /** 編集モードで展開時に行内へ出す編集UI */
  editor?: React.ReactNode
  /** マーカー（開始点だけ）として表示する */
  markerMode?: boolean
  /** 再生モード: この行が範囲の開始行（選択中マーカー） */
  isRangeStart?: boolean
  /** 再生モード: 開始行より下の行（「ここまで」を出す） */
  showRangeEndBtn?: boolean
  /** 再生モード: この行が範囲の終了マーカー */
  isRangeEnd?: boolean
  /** 再生モード: 範囲選択に含まれる行（背景色を変える） */
  inRange?: boolean
  rangeLoop?: boolean
  onToggleRangeLoop?: () => void
  /** 開始行の再生ボタン（範囲再生の唯一の入口） */
  onPlayRange?: () => void
  /** この行を範囲の終了マーカーにする */
  onChooseRangeEnd?: () => void
  /** 開始行の [範囲DL] ボタン */
  onDownloadRange?: () => void
  dlRangeBusy?: boolean
}

/**
 * マーカーリストの1行。
 * 再生モード: 全行に再生ボタンは置かない。選択した行（開始行）にだけ
 * 「ここから」表示＋範囲DL・ループ・再生（この並び）が出て、下の行には「ここまで」が出る。
 * 編集モードでは行を展開して、行内に編集UI（FlagEditor）が出る。
 */
export function SectionItem({
  section,
  mode,
  isActive,
  onPlay,
  onUpdate,
  onActivate,
  onSelectOnly,
  editor,
  markerMode,
  isRangeStart,
  showRangeEndBtn,
  isRangeEnd,
  inRange,
  rangeLoop,
  onToggleRangeLoop,
  onPlayRange,
  onChooseRangeEnd,
  onDownloadRange,
  dlRangeBusy,
}: Props) {
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(section.label)

  const handleLabelTap = (e: React.MouseEvent) => {
    if (mode !== 'edit') return
    e.stopPropagation()
    ;(onSelectOnly ?? onActivate)(section.id)
    setLabelVal(section.label)
    setEditingLabel(true)
  }

  const saveLabel = () => {
    onUpdate(section.id, { label: labelVal })
    setEditingLabel(false)
  }

  return (
    <div
      className={`section-item ${isActive ? 'active' : ''}${inRange ? ' in-range' : ''}`}
      style={{ borderLeft: `4px solid ${section.color}` }}
    >
      <div className="section-item-main" onClick={() => onActivate(section.id)}>
        <div className="section-item-info">
          {editingLabel ? (
            <input
              className="label-input"
              value={labelVal}
              autoFocus
              onChange={(e) => setLabelVal(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => e.key === 'Enter' && saveLabel()}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className={`section-label ${mode === 'edit' ? 'editable' : ''}`}
              onClick={handleLabelTap}
              title={mode === 'edit' ? 'タップで名前を編集' : section.label}
            >
              {section.label}
              {mode === 'edit' && <span className="edit-hint"> ✏️</span>}
            </span>
          )}
          {mode === 'play' && isRangeStart && (
            <span className="range-from-badge">ここから</span>
          )}
        </div>
        <span className="section-time">
          {markerMode ? formatTime(section.startTime) : `${formatTime(section.startTime)} – ${formatTime(section.endTime)}`}
        </span>
        {mode === 'play' && isRangeStart && (
          <span className="section-item-controls">
            <button
              type="button"
              className="marker-dl-btn"
              onClick={(e) => { e.stopPropagation(); onDownloadRange?.() }}
              disabled={dlRangeBusy}
              title="選択中の範囲をMP3で保存"
            >{dlRangeBusy ? '書出中' : '範囲DL'}</button>
            <button
              type="button"
              className={`range-loop-chip${rangeLoop ? ' on' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleRangeLoop?.() }}
              aria-pressed={!!rangeLoop}
              title="範囲を繰り返し再生"
            >ループ {rangeLoop ? 'ON' : 'OFF'}</button>
            <button
              type="button"
              className="marker-play-btn"
              title="ここから範囲を再生"
              onClick={(e) => { e.stopPropagation(); onPlayRange?.() }}
            >▶</button>
          </span>
        )}
        {mode === 'play' && showRangeEndBtn && (
          <button
            type="button"
            className={`range-to-btn${isRangeEnd ? ' on' : ''}`}
            onClick={(e) => { e.stopPropagation(); onChooseRangeEnd?.() }}
            aria-pressed={!!isRangeEnd}
            title="このマーカーまでを範囲にする"
          >ここまで</button>
        )}
        {mode === 'edit' && (
          <button
            className="marker-play-btn"
            title="このマーカーから再生"
            onClick={(e) => { e.stopPropagation(); onPlay(section.startTime, section.endTime) }}
          >▶</button>
        )}
      </div>
      {editor}
    </div>
  )
}
