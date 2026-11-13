import { useEffect, useRef, useState } from 'react'
import { Section, AppMode } from '../../types'
import { SectionItem } from './SectionItem'
import { FlagEditor } from './FlagEditor'
import { downloadCurrentMix, getCurrentManifest } from '../../multiplay/bridge'

interface Props {
  sections: Section[]
  mode: AppMode
  duration: number
  audioSrc: string
  editAdjustValues: number[]
  currentTime: number
  activeSectionId: string | null
  onPlay: (start: number, end: number) => void
  onUpdate: (id: string, updates: Partial<Section>) => void
  onDelete: (id: string) => void
  onActivate: (id: string) => void
  scrollTarget?: { id: string; seq: number } | null
  fileName?: string
  onAddSection: () => void
  onUndo: () => void
  onRedo: () => void
  undoCount: number
  redoCount: number
  /** マーカー（開始点だけ）として表示・編集する */
  markerMode?: boolean
}

/**
 * マーカーリスト。並びは常に時間順（開始時刻の昇順）で固定。
 * 編集モードでは、選択中マーカーの編集ブロックをリスト下部に1つだけ出す。
 */
export function SectionList({
  sections,
  mode,
  duration,
  audioSrc,
  editAdjustValues,
  activeSectionId,
  onPlay,
  onUpdate,
  onDelete,
  onActivate,
  scrollTarget,
  fileName,
  onAddSection,
  onUndo,
  onRedo,
  undoCount,
  redoCount,
  markerMode,
}: Props) {
  const [dlAll, setDlAll] = useState(false)
  const [armDeleteId, setArmDeleteId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Scroll to the target marker row
  useEffect(() => {
    if (!scrollTarget || !listRef.current) return
    const listEl = listRef.current
    const row = listEl.querySelector(`[data-section-id="${scrollTarget.id}"]`) as HTMLElement | null
    if (!row) return
    const header = listEl.querySelector('.section-list-header') as HTMLElement | null
    const headerH = header?.clientHeight ?? 0
    const listRect = listEl.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    listEl.scrollBy({ top: rowRect.top - listRect.top - headerH, behavior: 'smooth' })
  }, [scrollTarget])

  const handleDownloadAll = async () => {
    if (!audioSrc) return
    setDlAll(true)
    try {
      if (getCurrentManifest()) {
        // 現在のトラックバランスで全体を書き出す
        await downloadCurrentMix(`${fileName ? fileName + '_' : ''}ミックス.wav`)
      }
    } catch (e) {
      alert(`ダウンロードに失敗しました: ${e}`)
    } finally {
      setDlAll(false)
    }
  }

  // 常に時間順
  const displayed = [...sections].sort((a, b) => a.startTime - b.startTime)
  const active = mode === 'edit' ? displayed.find(s => s.id === activeSectionId) ?? null : null

  const handleDelete = (s: Section) => {
    if (armDeleteId !== s.id) {
      setArmDeleteId(s.id)
      if (armTimerRef.current) clearTimeout(armTimerRef.current)
      armTimerRef.current = setTimeout(() => setArmDeleteId(null), 3000)
      return
    }
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    setArmDeleteId(null)
    onDelete(s.id)
  }

  return (
    <div className="section-list" ref={listRef}>
      <div className="section-list-header">
        <span className="section-list-title">マーカーリスト</span>
        <div className="section-list-actions">
          {mode === 'edit' && (
            <button className="icon-btn" onClick={onAddSection} title="現在位置にマーカーを追加">＋</button>
          )}
          {/* Undo */}
          <button
            className="icon-btn badge-btn"
            onClick={onUndo}
            disabled={undoCount === 0}
            title={`元に戻す (${undoCount})`}
          >
            ↩
            {undoCount > 0 && <span className="icon-badge">{undoCount > 99 ? '99+' : undoCount}</span>}
          </button>
          {/* Redo */}
          <button
            className="icon-btn badge-btn"
            onClick={onRedo}
            disabled={redoCount === 0}
            title={`やり直す (${redoCount})`}
          >
            ↪
            {redoCount > 0 && <span className="icon-badge">{redoCount > 99 ? '99+' : redoCount}</span>}
          </button>
        </div>
      </div>

      {displayed.length === 0 ? (
        <p className="no-sections">
          {mode === 'edit' ? '＋ボタンでマーカーを追加できます' : 'マーカーが設定されていません'}
        </p>
      ) : (
        displayed.map((s) => (
          <div key={s.id} data-section-id={s.id}>
            <SectionItem
              section={s}
              mode={mode}
              isActive={activeSectionId === s.id}
              onPlay={onPlay}
              onUpdate={onUpdate}
              onActivate={onActivate}
              markerMode={markerMode}
            />
          </div>
        ))
      )}

      {active && (
        <div className="marker-edit-block">
          <FlagEditor
            key={active.id}
            section={active}
            duration={duration}
            editAdjustValues={editAdjustValues}
            onUpdate={onUpdate}
            onPlay={onPlay}
            markerMode={markerMode}
          />
          <button
            className="action-btn delete compact"
            onClick={() => handleDelete(active)}
          >
            {armDeleteId === active.id ? `🗑 もう一度押すと「${active.label}」を削除` : '🗑 このマーカーを削除'}
          </button>
        </div>
      )}

      {mode === 'play' && audioSrc && (
        <button className="download-all-btn" onClick={handleDownloadAll} disabled={dlAll}>
          {dlAll ? 'ダウンロード中...' : '⬇ このバランスでダウンロード'}
        </button>
      )}
    </div>
  )
}
