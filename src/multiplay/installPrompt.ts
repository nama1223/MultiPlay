/**
 * PWA インストールプロンプトの早期捕捉。
 * beforeinstallprompt はページ読み込み直後に発火することが多く、
 * 設定画面で初めてマウントされるボタンでは取り逃がすため、
 * モジュール読み込み時点（アプリ起動直後）で捕まえて保持する。
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installedFlag = false
const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    installedFlag = true
    notify()
  })
}

/** インストール済みかどうか（standalone 起動 / appinstalled 後） */
export function isPwaInstalled(): boolean {
  if (installedFlag) return true
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
  } catch { /* noop */ }
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt
}

export function clearDeferredInstallPrompt() {
  deferredPrompt = null
  notify()
}

export function markPwaInstalled() {
  installedFlag = true
  deferredPrompt = null
  notify()
}

/** 捕捉状態の変化を購読する（戻り値は解除関数） */
export function subscribeInstallPrompt(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
