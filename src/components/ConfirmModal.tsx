import { useState } from 'react'

interface Props {
  title: string
  confirmLabel?: string
  /** true にすると、確認ボタンの1回目は「本当に〜」への武装で、2回目で実行する */
  requireSecondPress?: boolean
  armedLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: React.ReactNode
}

/** アプリ内モーダルの2段階確認（ネイティブ confirm は使わない） */
export function ConfirmModal({
  title, confirmLabel = '削除する', requireSecondPress = false, armedLabel,
  busy = false, onConfirm, onCancel, children,
}: Props) {
  const [armed, setArmed] = useState(false)
  const press = () => {
    if (requireSecondPress && !armed) { setArmed(true); return }
    onConfirm()
  }
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="mp-modal-box" onClick={e => e.stopPropagation()}>
        <h3 className="mp-modal-title">{title}</h3>
        <div className="mp-modal-body">{children}</div>
        <div className="mp-modal-actions">
          <button className="mp-btn sub" disabled={busy} onClick={onCancel}>キャンセル</button>
          <button className="mp-btn danger" disabled={busy} onClick={press}>
            {busy ? '処理中…' : armed ? (armedLabel ?? '本当に削除する（取り消せません）') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
