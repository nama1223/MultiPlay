import { useState, useEffect } from 'react'
import { indexUrl } from '../config'
import { OrgInfo, getStoredOrgs, storeOrg } from '../hooks/useOrgAuth'
import type { MpGroup } from '../multiplay/types'

export type { OrgInfo }

interface Props {
  onAuth: (org: OrgInfo) => void
  onAdmin: () => void
}

/**
 * 団体（グループ）の選択画面。RecPlay の AuthPage の構成をそのまま使い、
 * パスワード認証の代わりに公開されている団体一覧から選ぶ形にした。
 */
export function AuthPage({ onAuth, onAdmin }: Props) {
  const [storedOrgs, setStoredOrgs] = useState<OrgInfo[]>(() => getStoredOrgs())
  const [groups, setGroups] = useState<MpGroup[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch(indexUrl())
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(j => { if (alive) { setGroups(j.groups ?? []); setLoading(false) } })
      .catch(() => { if (alive) { setError('団体の一覧を取得できませんでした'); setLoading(false) } })
    return () => { alive = false }
  }, [])

  const enter = (g: { id: string; name: string }) => {
    const org = { id: g.id, name: g.name }
    storeOrg(org)
    setStoredOrgs(getStoredOrgs())
    onAuth(org)
  }

  const storedIds = new Set(storedOrgs.map(o => o.id))
  const others = groups.filter(g => !storedIds.has(g.id))

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="file-loader-logo">🎵</div>
        <div className="file-loader-title">MultiPlay</div>
        <p className="file-loader-desc">パート別に聴ける、多重録音プレーヤー</p>

        {storedOrgs.length > 0 && (
          <div className="stored-orgs">
            {storedOrgs.map(o => (
              <button key={o.id} className="org-btn" onClick={() => enter(o)}>
                🎵 {o.name}
              </button>
            ))}
          </div>
        )}

        {storedOrgs.length > 0 && <hr className="auth-divider" />}

        <div className="auth-form">
          <p className="auth-new-label" style={{ marginTop: 0 }}>
            {storedOrgs.length > 0 ? '別の団体に入る' : '団体を選んでください'}
          </p>
          {loading && <p className="hint-text">読み込み中...</p>}
          {error && <p className="error-text">{error}</p>}
          <div className="stored-orgs">
            {others.map(g => (
              <button key={g.id} className="org-btn" onClick={() => enter(g)}>
                🎵 {g.name}
              </button>
            ))}
          </div>
          {!loading && !error && groups.length === 0 && (
            <p className="hint-text">まだ団体が登録されていません</p>
          )}
        </div>

        <hr className="auth-divider" />
        <div className="admin-section">
          <button className="text-link" onClick={onAdmin}>管理者ログイン</button>
        </div>
      </div>
    </div>
  )
}
