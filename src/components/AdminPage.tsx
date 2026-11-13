import { useEffect, useState } from 'react'
import {
  getAdminToken, setAdminToken, clearAdminToken, checkToken,
  fetchIndexFresh, fetchSongFresh, saveIndex, saveSongManifest,
  deleteSongCompletely, fetchStorageReport, cleanupOrphans,
} from '../multiplay/api'
import type { MpGroup, MpIndex, MpStorageReport } from '../multiplay/types'
import { ConfirmModal } from './ConfirmModal'

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 音声置き場（Backblaze B2）の無料枠。B2 自体に容量の上限はなく従量課金なので、これは「目安」の表示専用 */
const B2_FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024

/**
 * 管理者メニュー。管理者資格の付与、団体の一覧・追加・名前編集・削除、
 * 容量管理（団体・曲ごとの使用量と孤立ファイルの掃除）をここで行う。
 * 曲の作成と曲ごとの操作は各団体の曲一覧から、曲データの編集は各曲の「編集」モードで行う。
 */
export function AdminPage({ onLogout }: { onLogout: () => void }) {
  const [authed, setAuthed] = useState(!!getAdminToken())
  const [pass, setPass] = useState('')
  const [index, setIndex] = useState<MpIndex | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [deleteGroup, setDeleteGroup] = useState<MpGroup | null>(null)
  const [storage, setStorage] = useState<MpStorageReport | null>(null)
  const [storageBusy, setStorageBusy] = useState(false)
  const [storageMsg, setStorageMsg] = useState('')
  const [cleanConfirm, setCleanConfirm] = useState(false)

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

  const saveGroupRename = async (g: MpGroup) => {
    const name = renameText.trim()
    if (!index || !name || busy) return
    setBusy(true)
    setMsg('')
    try {
      const next: MpIndex = { groups: index.groups.map(x => x.id === g.id ? { ...x, name } : x) }
      await saveIndex(next)
      setIndex(next)
      // 各曲の manifest にも団体名が入っているのでそろえる（失敗しても一覧側は正とする）
      for (const s of g.songs) {
        try {
          const m = await fetchSongFresh(s.id)
          if (m.groupName !== name) { m.groupName = name; await saveSongManifest(m) }
        } catch { /* 曲側の団体名はベストエフォート */ }
      }
      setRenamingId(null)
      setMsg(`団体名を「${name}」に変更しました`)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  const doDeleteGroup = async () => {
    const g = deleteGroup
    if (!index || !g || busy) return
    setBusy(true)
    setMsg('')
    try {
      for (const s of g.songs) await deleteSongCompletely(s.id)
      const next: MpIndex = { groups: index.groups.filter(x => x.id !== g.id) }
      await saveIndex(next)
      setIndex(next)
      setDeleteGroup(null)
      setStorage(null)
      setMsg(`団体「${g.name}」を削除しました`)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  const loadStorage = async () => {
    setStorageBusy(true)
    setStorageMsg('')
    try {
      setStorage(await fetchStorageReport())
    } catch (e) { setStorageMsg(e instanceof Error ? e.message : String(e)) }
    setStorageBusy(false)
  }

  const orphanTotal = storage
    ? storage.orphanSongs.reduce((a, s) => a + s.bytes, 0) + storage.orphanFiles.reduce((a, f) => a + f.bytes, 0)
    : 0
  const orphanCount = storage ? storage.orphanSongs.length + storage.orphanFiles.length : 0

  const doCleanup = async () => {
    if (!storage || storageBusy) return
    setStorageBusy(true)
    setStorageMsg('')
    try {
      const r = await cleanupOrphans({
        keys: storage.orphanFiles.map(f => f.key),
        songIds: storage.orphanSongs.map(s => s.id),
      })
      setCleanConfirm(false)
      setStorageMsg(`${r.deleted.length} 件のファイルを削除しました`)
      setStorage(await fetchStorageReport())
    } catch (e) { setStorageMsg(e instanceof Error ? e.message : String(e)) }
    setStorageBusy(false)
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

      <h3 className="mp-admin-h">団体の一覧</h3>
      {!index && <p className="mp-msg">読み込み中…</p>}
      {index && index.groups.length === 0 && <p className="mp-subtitle">団体はまだありません</p>}
      {index && index.groups.map(g => (
        <div key={g.id} className="mp-group-row">
          {renamingId === g.id ? (
            <>
              <input className="mp-input grow" value={renameText} onChange={e => setRenameText(e.target.value)} placeholder="団体名" autoFocus />
              <button className="mp-btn tiny" disabled={busy || !renameText.trim()} onClick={() => saveGroupRename(g)}>{busy ? '保存中…' : '保存'}</button>
              <button className="mp-btn tiny sub" disabled={busy} onClick={() => setRenamingId(null)}>キャンセル</button>
            </>
          ) : (
            <>
              <span className="mp-group-name">🎵 {g.name}</span>
              <span className="mp-song-meta">{g.songs.length} 曲</span>
              <button className="mp-btn tiny" disabled={busy} onClick={() => { setRenamingId(g.id); setRenameText(g.name) }}>名前編集</button>
              <button className="mp-btn tiny danger" disabled={busy} onClick={() => setDeleteGroup(g)}>削除</button>
            </>
          )}
        </div>
      ))}

      <h3 className="mp-admin-h">団体を追加</h3>
      {index && (
        <div className="mp-admin-row">
          <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="新しい団体名" className="mp-input" />
          <button className="mp-btn" disabled={busy || !newGroupName.trim()} onClick={addGroup}>団体を追加</button>
        </div>
      )}

      <h3 className="mp-admin-h">容量管理</h3>
      <p className="mp-subtitle">
        音声置き場（Backblaze B2）の実際の使用量です。B2 に容量の上限はなく従量課金のため、
        ここでは上限ではなく「今どれだけ使っているか」だけを表示します（無料枠は 10GB が目安で、超えても課金で使えます）。
      </p>
      {!storage && (
        <button className="mp-btn" disabled={storageBusy} onClick={loadStorage}>{storageBusy ? '集計中…' : '容量を集計する'}</button>
      )}
      {storageMsg && <p className="mp-admin-msg">{storageMsg}</p>}
      {storage && (
        <div className="mp-storage">
          <p className="mp-storage-total">
            合計: <strong>{fmt(storage.totalBytes)}</strong>（{storage.totalObjects} ファイル）
            <span className="mp-song-meta"> ／ 無料枠 10GB の目安まで残り約 {fmt(Math.max(0, B2_FREE_TIER_BYTES - storage.totalBytes))}</span>
          </p>
          {storage.groups.map(g => (
            <div key={g.id} className="mp-storage-group">
              <div className="mp-storage-group-head"><span>🎵 {g.name}</span><span>{fmt(g.bytes)}</span></div>
              {g.songs.map(s => (
                <div key={s.id} className="mp-storage-song"><span>{s.title}</span><span className="mp-song-meta">{fmt(s.bytes)}（{s.objects} ファイル）</span></div>
              ))}
              {g.songs.length === 0 && <div className="mp-storage-song"><span className="mp-song-meta">曲なし</span></div>}
            </div>
          ))}
          {storage.otherObjects > 0 && (
            <p className="mp-subtitle">その他（一覧データなど）: {fmt(storage.otherBytes)}（{storage.otherObjects} ファイル）</p>
          )}
          <h4 className="mp-admin-h">孤立ファイル</h4>
          {orphanCount === 0 && <p className="mp-subtitle">孤立ファイルはありません</p>}
          {storage.orphanSongs.map(s => (
            <div key={s.id} className="mp-storage-song"><span>曲フォルダ {s.id}（一覧に無い曲）</span><span className="mp-song-meta">{fmt(s.bytes)}（{s.objects} ファイル）</span></div>
          ))}
          {storage.orphanFiles.map(f => (
            <div key={f.key} className="mp-storage-song"><span className="mp-orphan-key">{f.key}</span><span className="mp-song-meta">{fmt(f.bytes)}</span></div>
          ))}
          {orphanCount > 0 && (
            <div className="mp-admin-row">
              <span className="mp-subtitle">孤立ファイル合計: {fmt(orphanTotal)}</span>
              <button className="mp-btn danger" disabled={storageBusy} onClick={() => setCleanConfirm(true)}>孤立ファイルを削除する</button>
            </div>
          )}
          <button className="mp-btn sub" disabled={storageBusy} onClick={loadStorage}>{storageBusy ? '集計中…' : '再集計'}</button>
        </div>
      )}

      <h3 className="mp-admin-h">曲の作成・編集について</h3>
      <p className="mp-subtitle">
        新しい曲の作成と、曲の名前変更・複製・削除は、各団体の「曲一覧」画面から行います（管理者ログイン中のみ表示されます）。
        曲のタイトルやトラック構成の編集は、曲を開いて「編集」モードの「曲データの編集」から行います。
        練習マーカーも同じ「編集」モードで設定します。
      </p>

      {deleteGroup && (
        <ConfirmModal
          title="団体を削除しますか？"
          confirmLabel="削除へ進む"
          requireSecondPress
          busy={busy}
          onConfirm={doDeleteGroup}
          onCancel={() => setDeleteGroup(null)}
        >
          <p>団体「{deleteGroup.name}」を削除します。配下の {deleteGroup.songs.length} 曲と、その音声ファイルがすべて完全に消え、元に戻せません。</p>
        </ConfirmModal>
      )}

      {cleanConfirm && storage && (
        <ConfirmModal
          title="孤立ファイルを削除しますか？"
          confirmLabel="削除する"
          busy={storageBusy}
          onConfirm={doCleanup}
          onCancel={() => setCleanConfirm(false)}
        >
          <p>どこからも参照されていない {orphanCount} 件（合計 {fmt(orphanTotal)}）を削除します。収録中の曲や音声は含まれていません。元に戻せません。</p>
        </ConfirmModal>
      )}
    </div>
  )
}
