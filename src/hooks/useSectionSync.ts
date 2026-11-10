import { useEffect, useRef, useState } from 'react'
import { Section, SECTION_COLORS } from '../types'
import { songUrl, API_BASE, FIXTURES } from '../config'
import { getCurrentManifest, setCurrentManifest } from '../multiplay/bridge'
import type { MpSongManifest } from '../multiplay/types'

export interface SyncStatus {
  lastSyncedAt: Date | null
  isDirty: boolean
}

const DEBOUNCE_MS = 1500

/** マーカー（点）→ RecPlay の区間（範囲）へ。区間iは次のマーカーまで。 */
export function sectionsFromManifest(m: MpSongManifest, durationHint = 0): Section[] {
  const markers = [...m.markers].sort((a, b) => a.time - b.time)
  return markers.map((mk, i) => ({
    id: `mk_${i}_${mk.time}`,
    label: mk.label,
    startTime: mk.time,
    endTime: i + 1 < markers.length ? markers[i + 1].time : Math.max(mk.time + 1, durationHint),
    isExcluded: false,
    color: SECTION_COLORS[i % SECTION_COLORS.length],
  }))
}

/** 区間 → マーカー（開始点とラベルだけを保存する） */
export function manifestWithSections(m: MpSongManifest, sections: Section[]): MpSongManifest {
  return {
    ...m,
    markers: [...sections]
      .sort((a, b) => a.startTime - b.startTime)
      .map(s => ({ time: Math.round(s.startTime * 1000) / 1000, label: s.label })),
  }
}

function adminToken(): string {
  return localStorage.getItem('mp_admin_token') ?? ''
}

/**
 * 区間（マーカー）の同期。保存先は曲の manifest.json。
 * 読み込みは公開API、書き込みは管理者の合言葉がある時だけ行う。
 */
export function useSectionSync(
  fileKey: string | null,
  fileLoadCounter: number,
  mode: string,
  sections: Section[],
  onRemoteUpdate: (sections: Section[]) => void,
): SyncStatus {
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const loadedForRef = useRef<string>('')
  const remoteJsonRef = useRef<string>('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onRemoteRef = useRef(onRemoteUpdate)
  onRemoteRef.current = onRemoteUpdate

  // 曲が選ばれたら manifest から区間を読む
  useEffect(() => {
    if (!fileKey) return
    const tag = `${fileKey}#${fileLoadCounter}`
    if (loadedForRef.current === tag) return
    loadedForRef.current = tag
    let cancelled = false
    ;(async () => {
      try {
        let m = getCurrentManifest()
        if (!m || m.id !== fileKey) {
          const res = await fetch(`${songUrl(fileKey)}?v=${Date.now()}`, { cache: 'no-store' })
          if (!res.ok) return
          m = (await res.json()) as MpSongManifest
          setCurrentManifest(m)
        }
        // エンジンの読み込み完了（duration確定）を少し待ってから区間を作る
        // （最後の区間の終了時刻＝曲の終わりに必要）
        const { engine } = await import('../multiplay/bridge')
        for (let i = 0; i < 20 && engine.duration <= 0 && !cancelled; i++) {
          await new Promise(r => setTimeout(r, 250))
        }
        if (cancelled) return
        const secs = sectionsFromManifest(m, engine.duration)
        remoteJsonRef.current = JSON.stringify(secs)
        onRemoteRef.current(secs)
        setLastSyncedAt(new Date())
        setIsDirty(false)
      } catch { /* 読み込み失敗時は空のまま */ }
    })()
    return () => { cancelled = true }
  }, [fileKey, fileLoadCounter])

  // 編集モードでの変更を manifest へ保存（合言葉がある場合のみ）
  useEffect(() => {
    if (!fileKey || mode !== 'edit') return
    if (!loadedForRef.current.startsWith(`${fileKey}#`)) return
    const json = JSON.stringify(sections)
    if (json === remoteJsonRef.current) return
    setIsDirty(true)
    if (!adminToken() || FIXTURES) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const m = getCurrentManifest()
      if (!m || m.id !== fileKey) return
      const next = manifestWithSections(m, sections)
      try {
        const res = await fetch(`${API_BASE}/api/admin/object?key=${encodeURIComponent(`songs/${fileKey}/manifest.json`)}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(next, null, 1),
        })
        if (res.ok) {
          setCurrentManifest(next)
          remoteJsonRef.current = json
          setLastSyncedAt(new Date())
          setIsDirty(false)
        }
      } catch { /* 保存失敗時は dirty のまま */ }
    }, DEBOUNCE_MS)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [sections, fileKey, mode])

  return { lastSyncedAt, isDirty }
}
