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
}

/**
 * マーカーリストの1行。常に1行表示＋再生ボタン常時表示。
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
      className={`section-item ${isActive ? 'active' : ''}`}
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
        </div>
        <span className="section-time">
          {markerMode ? formatTime(section.startTime) : `${formatTime(section.startTime)} – ${formatTime(section.endTime)}`}
        </span>
        <button
          className="marker-play-btn"
          title="このマーカーから再生"
          onClick={(e) => { e.stopPropagation(); onPlay(section.startTime, section.endTime) }}
        >▶</button>
      </div>
      {editor}
    </div>
  )
}
