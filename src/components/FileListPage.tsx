import { useCallback, useEffect, useState } from 'react'
import { OrgInfo } from '../hooks/useOrgAuth'
import { deleteSongCompletely, duplicateSong, fetchIndexFresh, fetchSongFresh, saveIndex, saveSongManifest } from '../multiplay/api'
import type { MpSongManifest, MpSongSummary } from '../multiplay/types'
import { ConfirmModal } from './ConfirmModal'

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

interface Props {
  org: OrgInfo
  onFileSelect: (url: string, key: string, name: string) => void
  onRename?: (oldKey: string, newKey: string, newName: string) => void
  onLogout: () => void
  isAdmin?: boolean
}

/**
 * 団体の曲一覧。RecPlay の FileListPage の構成（ヘッダー＋カード一覧）をそのまま使い、
 * 中身を MultiPlay の曲（多重録音）に差し替えたもの。
 * 管理者には曲ごとの「名前変更／複製／削除」も出す（削除は音声の実体まで消える）。
 */
export function FileListPage({ org, onFileSelect, onLogout, isAdmin = false }: Props) {
  const [songs, setSongs] = useState<MpSongSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [createMsg, setCreateMsg] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MpSongSummary | null>(null)
  const [actionMsg, setActionMsg] = useState('')

  const reload = useCallback(async () => {
    const idx = await fetchIndexFresh()
    const g = idx.groups.find(x => x.id === org.id)
    setSongs(g?.songs ?? [])
    return idx
  }, [org.id])

  useEffect(() => {
    let alive = true
    setLoading(true)
    reload()
      .then(() => { if (alive) setLoading(false) })
      .catch(e => { if (alive) { setError(`曲の一覧を取得できませんでした（${e.message}）`); setLoading(false) } })
    return () => { alive = false }
  }, [reload])

  const createSong = async () => {
    const title = newTitle.trim()
    if (!title || creating) return
    setCreating(true)
    setCreateMsg('')
    try {
      const m: MpSongManifest = { id: newId('s'), title, groupId: org.id, groupName: org.name, tracks: [], markers: [] }
      await saveSongManifest(m)
      const idx = await fetchIndexFresh()
      await saveIndex({ groups: idx.groups.map(g => g.id === org.id ? { ...g, songs: [...g.songs, { id: m.id, title: m.title, trackCount: 0 }] } : g) })
      // 作った曲をそのままプレイヤーで開く（トラック追加は「編集」モードで）
      onFileSelect(m.id, m.id, m.title)
    } catch (e) {
      setCreateMsg(e instanceof Error ? e.message : String(e))
      setCreating(false)
    }
  }

  const saveRename = async (s: MpSongSummary) => {
    const title = renameText.trim()
    if (!title || busyId) return
    setBusyId(s.id)
    setActionMsg('')
    try {
      const m = await fetchSongFresh(s.id)
      m.title = title
      await saveSongManifest(m)
      const idx = await fetchIndexFresh()
      await saveIndex({ groups: idx.groups.map(g => g.id === org.id ? { ...g, songs: g.songs.map(x => x.id === s.id ? { ...x, title } : x) } : g) })
      setSongs(prev => prev.map(x => x.id === s.id ? { ...x, title } : x))
      setRenamingId(null)
    } catch (e) { setActionMsg(e instanceof Error ? e.message : String(e)) }
    setBusyId(null)
  }

  const doDuplicate = async (s: MpSongSummary) => {
    if (busyId) return
    setBusyId(s.id)
    setActionMsg('')
    try {
      const r = await duplicateSong(s.id)
      const idx = await fetchIndexFresh()
      const next = { groups: idx.groups.map(g => g.id === org.id ? { ...g, songs: [...g.songs, { id: r.id, title: r.title, trackCount: r.trackCount }] } : g) }
      await saveIndex(next)
      const g = next.groups.find(x => x.id === org.id)
      setSongs(g?.songs ?? [])
      setActionMsg(`「${r.title}」を作成しました`)
    } catch (e) { setActionMsg(e instanceof Error ? e.message : String(e)) }
    setBusyId(null)
  }

  const doDelete = async () => {
    const s = deleteTarget
    if (!s || busyId) return
    setBusyId(s.id)
    setActionMsg('')
    try {
      await deleteSongCompletely(s.id)
      const idx = await fetchIndexFresh()
      await saveIndex({ groups: idx.groups.map(g => ({ ...g, songs: g.songs.filter(x => x.id !== s.id) })) })
      setSongs(prev => prev.filter(x => x.id !== s.id))
      setDeleteTarget(null)
    } catch (e) { setActionMsg(e instanceof Error ? e.message : String(e)) }
    setBusyId(null)
  }

  return (
    <div className="file-list-page">
      <header className="app-header">
        <span className="app-title">🎵 {org.name}</span>
        <button className="change-btn" onClick={onLogout}>← 戻る</button>
      </header>

      <div className="file-list-body">
        {loading && <p className="hint-text">読み込み中...</p>}
        {error && <p className="error-text">{error}</p>}
        {actionMsg && <p className="mp-admin-msg">{actionMsg}</p>}
        {!loading && !error && songs.length === 0 && (
          <p className="no-sections">まだ曲がありません</p>
        )}
        <div className="file-items">
          {songs.map(s => (
            <div key={s.id} className="file-item-row">
              {renamingId === s.id ? (
                <div className="file-item-rename">
                  <input
                    className="mp-input grow"
                    value={renameText}
                    onChange={e => setRenameText(e.target.value)}
                    placeholder="曲の名前"
                    autoFocus
                  />
                  <button className="mp-btn tiny" disabled={busyId === s.id || !renameText.trim()} onClick={() => saveRename(s)}>
                    {busyId === s.id ? '保存中…' : '保存'}
                  </button>
                  <button className="mp-btn tiny sub" disabled={busyId === s.id} onClick={() => setRenamingId(null)}>キャンセル</button>
                </div>
              ) : (
                <>
                  <button className="file-item-btn" onClick={() => onFileSelect(s.id, s.id, s.title)}>
                    <span className="file-item-name">🎵 {s.title}</span>
                    {typeof s.trackCount === 'number' && (
                      <span className="file-item-meta">{s.trackCount} トラック</span>
                    )}
                  </button>
                  {isAdmin && (
                    <div className="file-item-actions mp-song-actions">
                      <button className="mp-btn tiny" disabled={busyId !== null} onClick={() => { setRenamingId(s.id); setRenameText(s.title) }}>名前変更</button>
                      <button className="mp-btn tiny" disabled={busyId !== null} onClick={() => doDuplicate(s)}>
                        {busyId === s.id ? '処理中…' : '複製'}
                      </button>
                      <button className="mp-btn tiny danger" disabled={busyId !== null} onClick={() => setDeleteTarget(s)}>削除</button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {isAdmin && (
          <div className="file-create">
            <div className="file-create-title">＋ 新しい曲を作成（管理者）</div>
            <div className="mp-admin-row">
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="新しい曲のタイトル"
                className="mp-input grow"
              />
              <button className="mp-btn" disabled={creating || !newTitle.trim()} onClick={createSong}>
                {creating ? '作成中…' : '曲を作成'}
              </button>
            </div>
            <p className="file-create-note">作成するとそのままプレイヤーが開きます。トラックの追加は「編集」モードの「曲データの編集」から。</p>
            {createMsg && <p className="error-text">{createMsg}</p>}
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="曲を削除しますか？"
          confirmLabel="削除する"
          busy={busyId === deleteTarget.id}
          onConfirm={doDelete}
          onCancel={() => setDeleteTarget(null)}
        >
          <p>「{deleteTarget.title}」を削除します。音声ファイルも含めて完全に消え、元に戻せません。</p>
        </ConfirmModal>
      )}
    </div>
  )
}
