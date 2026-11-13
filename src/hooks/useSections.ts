import { useRef, useState, useCallback } from 'react'
import { Section, SECTION_COLORS } from '../types'

const MAX_HISTORY = 50

export function useSections() {
  const [sections, setSections] = useState<Section[]>([])
  const nextNumRef = useRef(1)
  // 曲の尺（最後のマーカーの endTime 導出用）。App がエンジンの duration を渡す
  const durationRef = useRef(0)
  const setDurationHint = useCallback((d: number) => { durationRef.current = d }, [])

  /**
   * 全マーカーの endTime を「次のマーカーの開始位置（無ければ曲末）」で再導出する。
   * endTime は読み込み・作成時に一度だけ決まるため、開始位置が動くたびに再計算しないと
   * 古い endTime が「今は存在しない位置の上限」として残ってしまう。それを防ぐ正規化。
   */
  const normalizeEnds = useCallback((list: Section[]): Section[] => {
    if (list.length === 0) return list
    const sorted = [...list].sort((a, b) => a.startTime - b.startTime)
    const fallbackEnd = Math.max(...list.map(s => s.endTime), 0)
    const songEnd = durationRef.current > 0 ? durationRef.current : fallbackEnd
    const endOf = new Map<string, number>()
    sorted.forEach((s, i) => {
      endOf.set(s.id, i + 1 < sorted.length ? sorted[i + 1].startTime : Math.max(songEnd, s.startTime))
    })
    return list.map(s => ({ ...s, endTime: endOf.get(s.id) ?? s.endTime }))
  }, [])

  // ── History refs ────────────────────────────────────────────────────────
  const sectionsRef = useRef<Section[]>([])   // mirror of state (always current)
  const pastRef     = useRef<Section[][]>([]) // undo stack
  const futureRef   = useRef<Section[][]>([]) // redo stack
  const pendingRef  = useRef(false)           // true while debounce timer is running
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)

  // setSections that also keeps sectionsRef in sync
  const setSync = useCallback((updater: ((prev: Section[]) => Section[]) | Section[]) => {
    setSections((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      sectionsRef.current = next
      return next
    })
  }, [])

  // Immediate history push (for add / delete)
  const pushHistory = useCallback(() => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    pendingRef.current = false
    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), [...sectionsRef.current]]
    futureRef.current = []
    setUndoCount(pastRef.current.length)
    setRedoCount(0)
  }, [])

  // Debounced capture (for continuous edits like seekbar dragging or label typing).
  // Captures the state BEFORE the first change in a burst, then resets after 800ms of silence.
  const ensureHistory = useCallback(() => {
    if (!pendingRef.current) {
      pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), [...sectionsRef.current]]
      futureRef.current = []
      pendingRef.current = true
      setUndoCount(pastRef.current.length)
      setRedoCount(0)
    }
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = setTimeout(() => { pendingRef.current = false }, 800)
  }, [])

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return
    if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingRef.current = false }
    const restored = pastRef.current[pastRef.current.length - 1]
    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [[...sectionsRef.current], ...futureRef.current.slice(0, MAX_HISTORY - 1)]
    sectionsRef.current = restored
    setSections(restored)
    setUndoCount(pastRef.current.length)
    setRedoCount(futureRef.current.length)
  }, [])

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return
    const [next, ...rest] = futureRef.current
    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), [...sectionsRef.current]]
    futureRef.current = rest
    sectionsRef.current = next
    setSections(next)
    setUndoCount(pastRef.current.length)
    setRedoCount(rest.length)
  }, [])

  // ── Mutations ────────────────────────────────────────────────────────────
  const addSection = useCallback((startTime: number, endTime: number): string => {
    pushHistory()
    const num = nextNumRef.current++
    const id = crypto.randomUUID()
    setSync((prev) => {
      const newSection: Section = {
        id,
        label: `マーカー ${num}`,
        startTime,
        endTime,
        isExcluded: false,
        color: SECTION_COLORS[(num - 1) % SECTION_COLORS.length],
      }
      return normalizeEnds([...prev, newSection])
    })
    return id
  }, [pushHistory, setSync, normalizeEnds])

  // updateSection uses debounced history (seekbar drag fires many times per second)
  // 開始位置が変わったら、全マーカーの endTime をその場で再導出して状態を正規化する
  const updateSection = useCallback((id: string, updates: Partial<Section>) => {
    ensureHistory()
    setSync((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
      return updates.startTime !== undefined ? normalizeEnds(next) : next
    })
  }, [ensureHistory, setSync, normalizeEnds])

  const deleteSection = useCallback((id: string) => {
    pushHistory()
    setSync((prev) => normalizeEnds(prev.filter((s) => s.id !== id)))
  }, [pushHistory, setSync, normalizeEnds])

  const importSections = useCallback((data: Section[]) => {
    sectionsRef.current = data
    setSections(data)
    nextNumRef.current = data.length + 1
    // Clear history on bulk import
    pastRef.current = []
    futureRef.current = []
    setUndoCount(0)
    setRedoCount(0)
  }, [])

  return {
    sections, setSections, setDurationHint,
    addSection, updateSection, deleteSection, importSections,
    undo, redo, undoCount, redoCount,
  }
}
