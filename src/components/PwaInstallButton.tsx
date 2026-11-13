import { useState, useEffect } from 'react'
import {
  getDeferredInstallPrompt,
  clearDeferredInstallPrompt,
  isPwaInstalled,
  markPwaInstalled,
  subscribeInstallPrompt,
} from '../multiplay/installPrompt'

/**
 * 「アプリとしてインストール」ボタン（RecPlay と統一仕様）。
 * インストール済みでもボタンは消さず、無効化して「✔ インストール済」と表示し続ける。
 */
export function PwaInstallButton() {
  const [, setTick] = useState(0)
  const [installed, setInstalled] = useState<boolean>(() => isPwaInstalled())
  const [showModal, setShowModal] = useState(false)
  const [modalContent, setModalContent] = useState({ title: '', body: '' })

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios/i.test(navigator.userAgent)

  useEffect(() => {
    const update = () => {
      setInstalled(isPwaInstalled())
      setTick((t) => t + 1)
    }
    update()
    return subscribeInstallPrompt(update)
  }, [])

  if (installed) {
    return (
      <button className="secondary-btn pwa-install-btn pwa-installed-btn" disabled>
        ✔ インストール済
      </button>
    )
  }

  const handleInstallClick = async () => {
    const deferredPrompt = getDeferredInstallPrompt()
    if (deferredPrompt) {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        clearDeferredInstallPrompt()
        markPwaInstalled()
        setInstalled(true)
      }
      return
    }
    if (isIOS) {
      setModalContent({
        title: 'iOSへのインストール方法',
        body: '<ol><li>Safari画面下部の <strong>共有ボタン（□↑）</strong> をタップ</li><li>「<strong>ホーム画面に追加</strong>」を選択</li><li>右上の「<strong>追加</strong>」をタップ</li></ol>',
      })
      setShowModal(true)
      return
    }
    setModalContent({
      title: 'インストール方法',
      body: '<ol><li><b>Chrome：</b>アドレスバー右端「⊕」または「⋮」→「アプリをインストール」</li><li><b>Edge：</b>「…」→「アプリ」→「このサイトをアプリとしてインストール」</li></ol>',
    })
    setShowModal(true)
  }

  return (
    <>
      <button className="secondary-btn pwa-install-btn" onClick={handleInstallClick}>
        📲 アプリとしてインストール
      </button>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="overflow-modal" style={{ maxWidth: 360 }}>
            <h3 className="overflow-title" style={{ color: '#c084fc', marginBottom: 8 }}>{modalContent.title}</h3>
            <div className="overflow-info" style={{ color: '#eeeeff', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: modalContent.body }} />
            <button className="primary-btn" style={{ marginTop: 12 }} onClick={() => setShowModal(false)}>閉じる</button>
          </div>
        </div>
      )}
    </>
  )
}
