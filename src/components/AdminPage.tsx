import { useEffect, useState } from 'react'
import {
  getAdminToken, setAdminToken, clearAdminToken, checkToken,
  fetchIndexFresh, saveIndex,
} from '../multiplay/api'
import type { MpIndex } from '../multiplay/types'

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

/**
 * 管理者メニュー。役割は「管理者資格の付与」と「団体の追加」だけ。
 * 曲の作成は各団体の曲一覧から、曲データの編集は各曲の「編集」モードで行う。
 */
export function AdminPage({ onLogout }: { onLogout: () => void }) {
  const [authed, setAuthed] = useState(!!getAdminToken())
  const [pass, setPass] = useState('')
  const [index, setIndex] = useState<MpIndex | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!authed) return
    fetchIndexFresh()
      .then(setIndex)
      .catch(e => setMsg(e instanceof Error ? e.message : String(e)))
  }, [authed])

  const tryLogin = async () => {
    setAdminToken(pass)
    setBusy(true)
    try {
      if (await checkToken()) { setAuthed(true); setMsg('') }
      else { clearAdminToken(); setMsg('合言葉が違うようです') }
    } catch { clearAdminToken(); setMsg('確認できませんでした（通信エラー）') }
    setBusy(false)
  }

  if (!authed) return (
    <div className="mp-admin">
      <button className="mp-back" onClick={onLogout}>‹ 曲一覧へ</button>
      <h2 className="mp-title">管理画面</h2>
      <p className="mp-subtitle">管理用の合言葉を入れてください（この端末に保存され、次回から自動で管理者になります）</p>
      <div className="mp-admin-row">
        <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="合言葉" className="mp-input" autoComplete="off" />
        <button className="mp-btn" disabled={busy || !pass} onClick={tryLogin}>入る</button>
      </div>
      {msg && <p className="mp-error">{msg}</p>}
    </div>
  )

  const addGroup = async () => {
    if (!index || !newGroupName.trim()) return
    setBusy(true)
    try {
      const g = { id: newId('g'), name: newGroupName.trim(), songs: [] }
      const next: MpIndex = { groups: [...index.groups, g] }
      await saveIndex(next)
      setIndex(next)
      setNewGroupName('')
      setMsg('団体を追加しました')
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  return (
    <div className="mp-admin">
      <button className="mp-back" onClick={onLogout}>‹ 曲一覧へ</button>
      <h2 className="mp-title">管理画面</h2>
      <div className="mp-admin-row">
        <span className="mp-subtitle">管理者としてログイン中</span>
        <button className="mp-btn sub" onClick={() => { clearAdminToken(); setAuthed(false); setPass('') }}>管理者をログアウト</button>
      </div>
      {msg && <p className="mp-admin-msg">{msg}</p>}

      <h3 className="mp-admin-h">団体を追加</h3>
      {!index && <p className="mp-msg">読み込み中…</p>}
      {index && (
        <>
          <p className="mp-subtitle">現在の団体: {index.groups.map(g => g.name).join(' / ') || '（なし）'}</p>
          <div className="mp-admin-row">
            <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="新しい団体名" className="mp-input" />
            <button className="mp-btn" disabled={busy || !newGroupName.trim()} onClick={addGroup}>団体を追加</button>
          </div>
        </>
      )}

      <h3 className="mp-admin-h">曲の作成・編集について</h3>
      <p className="mp-subtitle">
        新しい曲の作成は、各団体の「曲一覧」画面から行います（管理者ログイン中のみ表示されます）。
        曲のタイトルやトラック構成の編集は、曲を開いて「編集」モードの「曲データの編集」から行います。
        練習マーカーも同じ「編集」モードで設定します。
      </p>
    </div>
  )
}
