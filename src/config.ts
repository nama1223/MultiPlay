/** MultiPlay API の接続先。フィクスチャモードでは同一オリジンの /fixtures を使う。 */
export const FIXTURES = (import.meta.env.VITE_MP_FIXTURES as string) === '1'
export const API_BASE = FIXTURES ? '' : ((import.meta.env.VITE_MP_API_BASE as string) ?? 'https://api.nama1223.com')

export function indexUrl(): string {
  return FIXTURES ? '/fixtures/api/index.json' : `${API_BASE}/api/index`
}

export function songUrl(id: string): string {
  return FIXTURES ? `/fixtures/api/songs/${id}/manifest.json` : `${API_BASE}/api/song/${id}`
}

/** manifest 内のトラック URL を実 URL に解決する */
export function resolveTrackUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url
  if (FIXTURES) return url
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`
}

/** 互換用（RecPlay 由来の一部ユーティリティが参照する。MultiPlay では実質未使用） */
export const MP3_BITRATE = 192
export const WORKER_URL = API_BASE

/** 曲の共有URL（?song= 形式） */
export function buildAppShareUrl(songId: string): string {
  const origin = window.location.origin
  const path = window.location.pathname.replace(/\/?$/, '/')
  return `${origin}${path}?song=${encodeURIComponent(songId)}`
}
