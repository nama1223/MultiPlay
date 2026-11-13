/**
 * 音声ファイルの端末キャッシュ（Cache Storage）。
 * 上限を超えたら「最後に聴いたのが古い順」に消す（LRU）。
 * キャッシュはあくまで高速化用で、失敗しても必ずネットワーク取得に落とす。
 */

const CACHE_NAME = 'mp-audio-v1'
const META_KEY = 'mp_audio_cache_meta_v1'
const CAP_MB_KEY = 'mp_audio_cache_cap_mb_v1'
/** 容量上限の初期値（MB）。設定で変更できる */
export const AUDIO_CACHE_DEFAULT_CAP_MB = 1000
const MB = 1024 * 1024

/** 現在の容量上限（MB）。localStorage の設定値を読む */
export function getAudioCacheCapMb(): number {
  try {
    const v = Number(localStorage.getItem(CAP_MB_KEY))
    if (Number.isFinite(v) && v > 0) return Math.round(v)
  } catch { /* noop */ }
  return AUDIO_CACHE_DEFAULT_CAP_MB
}

export function getAudioCacheCapBytes(): number {
  return getAudioCacheCapMb() * MB
}

/** 容量上限を変更する。小さくした場合はその場で古い順に追い出す */
export async function setAudioCacheCapMb(mb: number): Promise<void> {
  const v = Math.max(1, Math.round(mb))
  try { localStorage.setItem(CAP_MB_KEY, String(v)) } catch { /* noop */ }
  await evictIfNeeded()
}

interface EntryMeta { size: number; lastUsed: number }
type Meta = Record<string, EntryMeta>

function readMeta(): Meta {
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? '{}') as Meta } catch { return {} }
}
function writeMeta(m: Meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)) } catch { /* 保存できなくても動作は続ける */ }
}

export function audioCacheUsage(): { bytes: number; count: number } {
  const meta = readMeta()
  const vals = Object.values(meta)
  return { bytes: vals.reduce((s, e) => s + e.size, 0), count: vals.length }
}

/** 上限を超えていたら古い順に消す */
async function evictIfNeeded(): Promise<void> {
  const cap = getAudioCacheCapBytes()
  const meta = readMeta()
  let total = Object.values(meta).reduce((s, e) => s + e.size, 0)
  if (total <= cap) return
  try {
    const cache = await caches.open(CACHE_NAME)
    const sorted = Object.entries(meta).sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [url, e] of sorted) {
      if (total <= cap) break
      await cache.delete(url)
      delete meta[url]
      total -= e.size
    }
    writeMeta(meta)
  } catch { /* 掃除に失敗しても再生は止めない */ }
}

export async function clearAudioCache(): Promise<void> {
  try { await caches.delete(CACHE_NAME) } catch { /* noop */ }
  writeMeta({})
}

/**
 * 音声を取得する。キャッシュにあればそれを使い、無ければネットから取って
 * （上限以下なら）キャッシュへ入れる。HTTP エラー時は Error を投げる。
 */
export async function fetchAudioBuffer(url: string): Promise<ArrayBuffer> {
  // キャッシュ照会
  try {
    const cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(url)
    if (hit) {
      const meta = readMeta()
      if (meta[url]) { meta[url].lastUsed = Date.now(); writeMeta(meta) }
      return await hit.arrayBuffer()
    }
  } catch { /* キャッシュが使えない環境ではネットへ */ }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ab = await res.arrayBuffer()

  // 上限を超える単体ファイルはキャッシュしない
  if (ab.byteLength <= getAudioCacheCapBytes()) {
    try {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(url, new Response(ab.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }))
      const meta = readMeta()
      meta[url] = { size: ab.byteLength, lastUsed: Date.now() }
      writeMeta(meta)
      void evictIfNeeded()
    } catch { /* 入らなくても再生は続ける */ }
  }
  return ab
}
