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

/** ポーリングの基本間隔と上限（読み出しAPIの消費を抑えるための間引き） */
export const POLL_BASE_MS = 60_000
export const POLL_MAX_MS = 300_000

/** 変化が無かった回数から次のポーリング間隔を決める（60秒→120秒→240秒→上限5分） */
export function nextPollDelayMs(unchangedCount: number): number {
  return Math.min(POLL_BASE_MS * 2 ** Math.max(0, unchangedCount), POLL_MAX_MS)
}

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
 * 読み込みは公開API。書き込みは、管理者は従来の管理者PUT、
 * それ以外の人は markers 専用エンドポイント（マーカー配列だけを差し替える）を使う。
 * 信頼モデルは RecPlay の区間と同じ「曲URLを知っている家族は編集可」。
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

  // 編集モードでの変更を manifest へ保存する
  useEffect(() => {
    if (!fileKey || mode !== 'edit') return
    if (!loadedForRef.current.startsWith(`${fileKey}#`)) return
    const json = JSON.stringify(sections)
    if (json === remoteJsonRef.current) return
    setIsDirty(true)
    if (FIXTURES) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const m = getCurrentManifest()
      if (!m || m.id !== fileKey) return
      const next = manifestWithSections(m, sections)
      try {
        const token = adminToken()
        const res = token
          ? await fetch(`${API_BASE}/api/admin/object?key=${encodeURIComponent(`songs/${fileKey}/manifest.json`)}`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(next, null, 1),
            })
          : await fetch(`${API_BASE}/api/song/${fileKey}/markers`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ markers: next.markers }),
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

  // 再生モードではポーリングし、他の人のマーカー編集を取り込む。
  // 読み出しAPIの回数を抑えるため、基本間隔は60秒、変化が無い間は段階的に最大5分まで延ばす。
  // タブが非表示の間は止め、再表示されたら間隔を戻してすぐ1回取りに行く。
  useEffect(() => {
    if (!fileKey || mode !== 'play' || FIXTURES) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let unchanged = 0

    const check = async (): Promise<boolean> => {
      try {
        const res = await fetch(`${songUrl(fileKey)}?v=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return false
        const m = (await res.json()) as MpSongManifest
        if (cancelled || !m || m.id !== fileKey) return false
        const { engine } = await import('../multiplay/bridge')
        const secs = sectionsFromManifest(m, engine.duration)
        const json = JSON.stringify(secs)
        if (json === remoteJsonRef.current) return false
        setCurrentManifest(m)
        remoteJsonRef.current = json
        onRemoteRef.current(secs)
        setLastSyncedAt(new Date())
        return true
      } catch { return false /* 取り込み失敗時は次の周期に回す */ }
    }

    const schedule = () => {
      if (cancelled || document.visibilityState !== 'visible') return
      timer = setTimeout(async () => {
        timer = null
        const changed = await check()
        unchanged = changed ? 0 : unchanged + 1
        schedule()
      }, nextPollDelayMs(unchanged))
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (timer) { clearTimeout(timer); timer = null }
        return
      }
      // 再表示されたら間隔を戻してすぐ取りに行く
      if (timer) { clearTimeout(timer); timer = null }
      unchanged = 0
      ;(async () => {
        const changed = await check()
        unchanged = changed ? 0 : 1
        schedule()
      })()
    }

    document.addEventListener('visibilitychange', onVisibility)
    schedule()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fileKey, mode])

  return { lastSyncedAt, isDirty }
}
