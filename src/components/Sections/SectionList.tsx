import { useEffect, useRef, useState } from 'react'
import { Section, AppMode } from '../../types'
import { SectionItem } from './SectionItem'
import { FlagEditor } from './FlagEditor'
import { downloadCurrentMix, getCurrentManifest, loadDownloadFormat, storeDownloadFormat, type DownloadFormat } from '../../multiplay/bridge'

interface Props {
  sections: Section[]
  mode: AppMode
  duration: number
  audioSrc: string
  editAdjustValues: number[]
  currentTime: number
  activeSectionId: string | null
  onPlay: (start: number, end: number) => void
  /** 再生モードの範囲選択: 終了マーカーのID（null = 未選択） */
  rangeEndId?: string | null
  /** 再生モードの範囲選択: ループON/OFF */
  rangeLoop?: boolean
  onChooseRangeEnd?: (id: string) => void
  onToggleRangeLoop?: () => void
  /** 開始行の再生ボタン（範囲再生の唯一の入口） */
  onPlayRange?: () => void
  /** 開始行の [DL] ボタン（現在の実効範囲を MP3 で切り取る） */
  onDownloadRange?: () => Promise<void>
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
 * 再生モードは「ここから/ここまで」の行操作で範囲を選ぶ（再生・DL・ループは開始行だけ）。
 * 編集モードは行を展開して、行内に編集UI（FlagEditor）を出す折りたたみ式。
 */
export function SectionList({
  sections,
  mode,
  duration,
  audioSrc,
  editAdjustValues,
  activeSectionId,
  onPlay,
  rangeEndId,
  rangeLoop,
  onChooseRangeEnd,
  onToggleRangeLoop,
  onPlayRange,
  onDownloadRange,
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
  const [dlRange, setDlRange] = useState(false)
  const [armDeleteId, setArmDeleteId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 波形側からマーカーが選ばれたら、編集モードではその行を展開する
  useEffect(() => {
    if (scrollTarget && mode === 'edit') setExpandedId(scrollTarget.id)
  }, [scrollTarget, mode])

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

  // ダウンロード形式（MP3/WAV）。選択は端末に保存される
  const [dlFormat, setDlFormat] = useState<DownloadFormat>(() => loadDownloadFormat())
  const chooseFormat = (f: DownloadFormat) => { setDlFormat(f); storeDownloadFormat(f) }

  const handleDownloadAll = async () => {
    if (!audioSrc) return
    setDlAll(true)
    try {
      if (getCurrentManifest()) {
        // 現在のトラックバランスで全体を書き出す
        await downloadCurrentMix(`${fileName ? fileName + '_' : ''}ミックス`, dlFormat)
      }
    } catch (e) {
      alert(`ダウンロードに失敗しました: ${e}`)
    } finally {
      setDlAll(false)
    }
  }

  // 常に時間順
  const displayed = [...sections].sort((a, b) => a.startTime - b.startTime)

  // 再生モードの範囲選択: 開始行（選択中マーカー）と終了行の位置（時間順の添字）。
  // 終了が開始より後ろに無い場合は範囲選択なしとして扱う
  const rangeStartIdx = mode === 'play' && activeSectionId
    ? displayed.findIndex(s => s.id === activeSectionId) : -1
  const rangeEndIdx = rangeStartIdx >= 0 && rangeEndId
    ? displayed.findIndex(s => s.id === rangeEndId) : -1
  const hasRange = rangeEndIdx > rangeStartIdx

  const handleRangeDownload = async () => {
    if (!onDownloadRange || dlRange) return
    setDlRange(true)
    try {
      await onDownloadRange()
    } catch (e) {
      alert(`ダウンロードに失敗しました: ${e}`)
    } finally {
      setDlRange(false)
    }
  }

  /** 行タップ: 選択し、編集モードではその行の展開/折りたたみも切り替える */
  const handleActivate = (id: string) => {
    onActivate(id)
    if (mode === 'edit') setExpandedId(prev => (prev === id ? null : id))
  }

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
        displayed.map((s, i) => {
          const expanded = mode === 'edit' && expandedId === s.id
          return (
            <div key={s.id} data-section-id={s.id}>
              <SectionItem
                section={s}
                mode={mode}
                isActive={activeSectionId === s.id}
                onPlay={onPlay}
                onUpdate={onUpdate}
                onActivate={handleActivate}
                onSelectOnly={onActivate}
                markerMode={markerMode}
                isRangeStart={mode === 'play' && i === rangeStartIdx}
                showRangeEndBtn={mode === 'play' && rangeStartIdx >= 0 && i > rangeStartIdx}
                isRangeEnd={hasRange && i === rangeEndIdx}
                inRange={hasRange && i >= rangeStartIdx && i <= rangeEndIdx}
                rangeLoop={rangeLoop}
                onToggleRangeLoop={onToggleRangeLoop}
                onPlayRange={onPlayRange}
                onChooseRangeEnd={onChooseRangeEnd ? () => onChooseRangeEnd(s.id) : undefined}
                onDownloadRange={handleRangeDownload}
                dlRangeBusy={dlRange}
                editor={expanded ? (
                  <div className="section-item-editor">
                    <FlagEditor
                      key={s.id}
                      section={s}
                      duration={duration}
                      editAdjustValues={editAdjustValues}
                      onUpdate={onUpdate}
                      onPlay={onPlay}
                      markerMode={markerMode}
                    />
                    <button
                      className="action-btn delete compact"
                      onClick={() => handleDelete(s)}
                    >
                      {armDeleteId === s.id ? `🗑 もう一度押すと「${s.label}」を削除` : '🗑 このマーカーを削除'}
                    </button>
                  </div>
                ) : undefined}
              />
            </div>
          )
        })
      )}

      {mode === 'play' && audioSrc && (
        <div className="download-row">
          <div className="dl-format-toggle" role="group" aria-label="ダウンロード形式">
            <button className={dlFormat === 'mp3' ? 'active' : ''} onClick={() => chooseFormat('mp3')} disabled={dlAll}>MP3</button>
            <button className={dlFormat === 'wav' ? 'active' : ''} onClick={() => chooseFormat('wav')} disabled={dlAll}>WAV</button>
          </div>
          <button className="download-all-btn" onClick={handleDownloadAll} disabled={dlAll}>
            {dlAll ? '書き出し中…' : '⬇ このバランスでダウンロード'}
          </button>
        </div>
      )}
    </div>
  )
}
