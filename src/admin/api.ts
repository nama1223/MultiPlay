import { API_BASE, FIXTURES, indexUrl, songUrl } from '../config'
import type { MpIndex, MpSongManifest } from '../types-multiplay'

const TOKEN_KEY = 'mp_admin_token'

export function getAdminToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? ''
}
export function setAdminToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
}
export function clearAdminToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${getAdminToken()}`, ...extra }
}

export async function fetchIndexFresh(): Promise<MpIndex> {
  const sep = indexUrl().includes('?') ? '&' : '?'
  const r = await fetch(`${indexUrl()}${sep}v=${Date.now()}`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`一覧の取得に失敗 (HTTP ${r.status})`)
  return r.json()
}

export async function fetchSongFresh(id: string): Promise<MpSongManifest> {
  const sep = songUrl(id).includes('?') ? '&' : '?'
  const r = await fetch(`${songUrl(id)}${sep}v=${Date.now()}`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`曲データの取得に失敗 (HTTP ${r.status})`)
  return r.json()
}

async function putObject(key: string, body: Blob | string, contentType: string): Promise<void> {
  if (FIXTURES) throw new Error('フィクスチャモードでは保存できません')
  const r = await fetch(`${API_BASE}/api/admin/object?key=${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: adminHeaders({ 'Content-Type': contentType }),
    body,
  })
  if (r.status === 401) throw new Error('合言葉が違います')
  if (!r.ok) throw new Error(`保存に失敗 (HTTP ${r.status})`)
}

async function deleteObject(key: string): Promise<void> {
  if (FIXTURES) return
  await fetch(`${API_BASE}/api/admin/object?key=${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  }).catch(() => { /* ファイル掃除はベストエフォート */ })
}

export function uploadAudio(songId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const key = `songs/${songId}/audio/${Date.now()}_${safe}`
  return putObject(key, file, file.type || 'application/octet-stream').then(() => `/${'file'}/${key}`)
}

export function deleteAudioByUrl(url: string): Promise<void> {
  const m = url.match(/\/file\/(.+)$/)
  if (!m) return Promise.resolve()
  return deleteObject(decodeURIComponent(m[1]))
}

export function saveSongManifest(manifest: MpSongManifest): Promise<void> {
  return putObject(`songs/${manifest.id}/manifest.json`, JSON.stringify(manifest, null, 1), 'application/json')
}

export function saveIndex(index: MpIndex): Promise<void> {
  return putObject('index.json', JSON.stringify(index, null, 1), 'application/json')
}

/** 合言葉が正しいかを、軽い書き込みなしに確認する（401 が返る経路を叩く） */
export async function checkToken(): Promise<boolean> {
  if (FIXTURES) return true
  const r = await fetch(`${API_BASE}/api/admin/object?key=__probe__`, {
    method: 'DELETE',
    headers: adminHeaders(),
  })
  // 401 以外（200/404/502など）は「認証は通った」とみなす
  return r.status !== 401
}
