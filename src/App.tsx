import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useSections } from './hooks/useSections'
import { useSettings } from './hooks/useSettings'
import { useSectionSync } from './hooks/useSectionSync'
import { OrgInfo, getStoredOrgs, storeOrg } from './hooks/useOrgAuth'
import { TrackSeekBar } from './components/SeekBar/TrackSeekBar'
import { PlaybackControls } from './components/Controls/PlaybackControls'
import { SectionList } from './components/Sections/SectionList'
import { ModeSelector } from './components/ModeSelector'
import { SettingsPanel, TutorialSettings } from './components/SettingsPanel'
import { AuthPage } from './components/AuthPage'
import { FileListPage } from './components/FileListPage'
import { AdminPage } from './components/AdminPage'
import { TrackMixer } from './components/TrackMixer'
import { ReverbControl } from './components/ReverbControl'
import { SongEditPanel } from './components/SongEditPanel'
import { AudioCachePanel } from './components/AudioCachePanel'
import { PwaInstallButton } from './components/PwaInstallButton'
import { formatTime } from './utils/timeFormat'
import { engine, loadPersonalMix, loadReverb, downloadRangeMix } from './multiplay/bridge'
import { AppMode, Section } from './types'
import { buildAppShareUrl, indexUrl } from './config'
import type { MpIndex } from './multiplay/types'
import './App.css'
import './multiplay2.css'

type Screen = 'auth' | 'files' | 'admin' | 'player'

// ── 最後に開いていた曲の記録（再読み込み・PWA再起動時の安全網） ──────────
// プルリロード等で意図せず再読み込みされても、認証状態（団体）がこの端末に
// 残っていれば、同じ曲を自動で開き直す。サーバーには上げず localStorage だけに残す。
const LAST_SESSION_KEY = 'mp_last_session_v1'
interface LastSession { orgId: string; songId: string; title: string; position: number; savedAt: number }
// 自動復元は「直近の利用」に限る: 最後に記録を更新してから30分を超えたら復元しない。
// 保存時刻を持たない旧形式の記録も、古いものとして復元しない。
const LAST_SESSION_MAX_AGE_MS = 30 * 60 * 1000

function loadLastSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<LastSession>
    if (typeof s.orgId !== 'string' || typeof s.songId !== 'string') return null
    const savedAt = typeof s.savedAt === 'number' && Number.isFinite(s.savedAt) ? s.savedAt : 0
    if (!savedAt || Date.now() - savedAt > LAST_SESSION_MAX_AGE_MS) return null
    return {
      orgId: s.orgId,
      songId: s.songId,
      title: typeof s.title === 'string' ? s.title : '',
      position: typeof s.position === 'number' && Number.isFinite(s.position) ? s.position : 0,
      savedAt,
    }
  } catch { return null }
}
function saveLastSession(s: LastSession): void {
  // 記録を更新するたびに保存時刻も更新する（＝最終活動時刻）
  try { localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ ...s, savedAt: Date.now() })) } catch { /* 保存できなくても動作は続ける */ }
}
function clearLastSession(): void {
  try { localStorage.removeItem(LAST_SESSION_KEY) } catch { /* noop */ }
}

export default function App() {
  const [screen, _setScreen] = useState<Screen>('auth')

  // History APIを利用してAndroidの「戻る」ボタンに対応する
  const setScreen = useCallback((newScreen: Screen, replace = false) => {
    _setScreen(newScreen)
    if (replace) {
      window.history.replaceState({ screen: newScreen }, '')
    } else {
      window.history.pushState({ screen: newScreen }, '')
    }
  }, [])

  useEffect(() => {
    window.history.replaceState({ screen: 'auth' }, '')
    const onPopState = (e: PopStateEvent) => {
      if (e.state && e.state.screen) {
        _setScreen(e.state.screen)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const [org, setOrg] = useState<OrgInfo | null>(null)
  const [mode, setMode] = useState<AppMode>('play')
  const [fileLoaded, setFileLoaded] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileKey, setFileKey] = useState<string | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  // 範囲再生（端末内だけの再生条件。サーバーには上げない）:
  // 開始マーカー = 選択中マーカー（activeSectionId）。終了マーカー = rangeEndId
  // （null = 未選択で、開始マーカー自身の区間だけが実効範囲）。
  // ループ = rangeLoop。範囲の組み立ては ref 側だけを見て行う（表示用 state とは
  // ハンドラで同時更新し、常に同じ値に保つ）。描画のタイミングに左右されず、
  // 画面に出ている選択がそのまま武装される値になるよう、単一の出所にするため
  const [rangeEndId, setRangeEndId] = useState<string | null>(null)
  const [rangeLoop, setRangeLoop] = useState(false)
  const activeSectionIdRef = useRef<string | null>(null)
  const rangeEndIdRef = useRef<string | null>(null)
  const rangeLoopRef = useRef(false)
  const applyRangeEnd = useCallback((v: string | null) => { rangeEndIdRef.current = v; setRangeEndId(v) }, [])
  const applyRangeLoop = useCallback((v: boolean) => { rangeLoopRef.current = v; setRangeLoop(v) }, [])
  const [fileLoadCounter, setFileLoadCounter] = useState(0)
  const [scrollTarget, setScrollTarget] = useState<{ id: string; seq: number } | null>(null)

  const {
    audioRef, currentTime, duration, isPlaying, src,
    togglePlayPause, seek, skip, playSection, clearRange,
    loadUrl,
    playbackRate, changePlaybackRate, loadState,
    pitchKeep, setPitchKeep, pendingRate, confirmRateChange, rateProcessing, rateError,
  } = useAudioPlayer()
  const [mixerKey, setMixerKey] = useState(0)

  // マーカー選択の単一入口: 別のマーカーを選んだら、その場で範囲選択を解除し、
  // 武装中の範囲も解除する（表示と監視を常に一致させる）。
  // 同じマーカーの再タップ: 範囲選択中なら終了だけを外して単体選択へ戻す
  // （開始マーカーの選択自体とループは維持。実効範囲が変わるので武装は解除）。
  // 範囲未選択の単体状態での再タップでは何も変えない
  const selectMarker = useCallback((id: string | null) => {
    if (id !== activeSectionIdRef.current) {
      applyRangeEnd(null)
      applyRangeLoop(false)
      clearRange()
    } else if (id != null && rangeEndIdRef.current != null) {
      applyRangeEnd(null)
      clearRange()
    }
    activeSectionIdRef.current = id
    setActiveSectionId(id)
  }, [applyRangeEnd, applyRangeLoop, clearRange])

  const { sections, addSection, updateSection, deleteSection, importSections, undo, redo, undoCount, redoCount, setDurationHint } = useSections()
  // endTime 再導出用に、エンジンの尺をマーカー状態側へ渡す
  useEffect(() => { setDurationHint(duration) }, [duration, setDurationHint])
  // フィクスチャビルドでのみ、検証用にマーカー状態を露出する（本番ビルドでは無効）
  useEffect(() => {
    if ((import.meta.env.VITE_MP_FIXTURES as string) === '1') {
      ;(window as unknown as { __mpSections?: Section[] }).__mpSections = sections
    }
  }, [sections])
  const { settings, updateSettings } = useSettings()
  // 管理者ログイン（localStorage に保存）の有無。編集モード自体は全員が使え、
  // 管理者だけが曲データ編集パネルも使える（マーカー編集は全員可）
  const [isAdmin, setIsAdmin] = useState(() => !!localStorage.getItem('mp_admin_token'))
  useEffect(() => {
    setIsAdmin(!!localStorage.getItem('mp_admin_token'))
  }, [screen])
  const [waveMenuOpen, setWaveMenuOpen] = useState(false)
  const waveMenuRef = useRef<HTMLDivElement>(null)
  const onRemoteUpdate = useCallback((secs: Section[]) => importSections(secs), [importSections])
  const { lastSyncedAt, isDirty } = useSectionSync(fileKey, fileLoadCounter, mode, sections, onRemoteUpdate)

  // ── チュートリアル連携（橋渡し） ──────────────────────────────────
  // ページID: files=曲一覧 / player=再生 / player-edit=編集 / player-settings=設定
  const screenRef = useRef(screen)
  screenRef.current = screen
  const modeRef = useRef(mode)
  modeRef.current = mode
  const orgRef = useRef(org)
  orgRef.current = org
  useEffect(() => {
    ;(window as unknown as { MultiPlayTutorialBridge?: unknown }).MultiPlayTutorialBridge = {
      navigate: (id: string) => {
        if (id === 'files') {
          if (orgRef.current) setScreen('files')
        } else if (id === 'player' || id === 'player-edit' || id === 'player-settings') {
          setScreen('player')
          setMode(id === 'player-edit' ? 'edit' : id === 'player-settings' ? 'settings' : 'play')
        }
      },
      currentPage: () => {
        const s = screenRef.current
        if (s !== 'player') return s
        const m = modeRef.current
        return m === 'edit' ? 'player-edit' : m === 'settings' ? 'player-settings' : 'player'
      },
      // チュートリアルの章の途中で触れる可能性のある、この端末内の設定キー
      // （章の開始時に保存し、終了・中断時に復元する。管理者トークンと団体リストは対象外）
      snapshotKeys: () => [
        'recplay_settings',
        'mp_mixer_open',
        'mp_pitch_keep_v1',
        'mp_audio_cache_cap_mb_v1',
        'mp_audio_cache_meta_v1',
      ],
    }
  }, [setScreen])

  // 曲の読み込みが終わったタイミングで、個人ミックス（端末に保存した音量バランス）を
  // エンジンへ再適用する。ミキサー側の適用が読み込みより先に走ると、
  // 読み込みで作り直された GainNode に届かず、表示と音が食い違うため。
  useEffect(() => {
    if (loadState.status !== 'ready' || !fileKey) return
    engine.applyMix(loadPersonalMix(fileKey))
    // リバーブ量も端末保存の値を復元する（エンジンの初期化順に左右されないよう ready で流す）
    engine.setReverb(loadReverb())
  }, [loadState.status, fileKey])

  // ── 最後に開いていた曲の記録と復元 ──────────────────────────────────
  const lastSessionRef = useRef<LastSession | null>(null)
  const restorePositionRef = useRef<number | null>(null)
  const currentTimeRef = useRef(0)
  useEffect(() => { currentTimeRef.current = currentTime }, [currentTime])
  const rememberSong = (orgId: string, songId: string, title: string) => {
    lastSessionRef.current = { orgId, songId, title, position: 0, savedAt: Date.now() }
    saveLastSession(lastSessionRef.current)
  }

  // 再生位置を定期的に記録する（再読み込み時に概算で復元するため）。
  // 画面を離れる瞬間（pagehide / 非表示化）にも書き出す。
  useEffect(() => {
    if (screen !== 'player' || !fileKey) return
    const write = () => {
      const s = lastSessionRef.current
      if (!s || s.songId !== fileKey) return
      const next = { ...s, position: Math.max(0, currentTimeRef.current) }
      lastSessionRef.current = next
      saveLastSession(next)
    }
    const iv = setInterval(write, 5000)
    const onVis = () => { if (document.visibilityState === 'hidden') write() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', write)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', write)
    }
  }, [screen, fileKey])

  // 復元した曲の読み込みが終わったら、記録しておいた位置へ移動する（概算でよい）
  useEffect(() => {
    if (loadState.status !== 'ready') return
    const p = restorePositionRef.current
    if (p == null) return
    restorePositionRef.current = null
    if (p > 3 && duration > 0 && p < duration - 2) seek(p)
  }, [loadState.status, duration]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── ?g=（団体リンク）/ ?song=（曲リンク）パラメータ ─────────────────────
  // URL指定が無い時は、最後に開いていた曲の復元（安全網）を試みる。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gParam = params.get('g')
    const songParam = params.get('song')

    fetch(indexUrl())
      .then(r => (r.ok ? r.json() : null))
      .then((idx: MpIndex | null) => {
        if (!idx) return
        if (songParam) {
          for (const g of idx.groups) {
            const s = g.songs.find(x => x.id === songParam)
            if (s) {
              const o = { id: g.id, name: g.name }
              storeOrg(o)
              setOrg(o)
              loadUrl(songParam)
              setFileName(s.title)
              setFileKey(songParam)
              setFileLoaded(true)
              setScreen('player', true)
              rememberSong(g.id, songParam, s.title)
              return
            }
          }
        }
        if (gParam) {
          const g = idx.groups.find(x => x.id === gParam)
          if (g) {
            const o = { id: g.id, name: g.name }
            storeOrg(o)
            setOrg(o)
            setScreen('files', true)
          }
          return
        }
        // ── 安全網: 最後に開いていた曲を自動で開き直す ──
        // 認証状態（団体）がこの端末に残っている場合に限る。
        const last = loadLastSession()
        if (!last) return
        if (!getStoredOrgs().some(o => o.id === last.orgId)) return
        const g = idx.groups.find(x => x.id === last.orgId)
        const s = g?.songs.find(x => x.id === last.songId)
        if (!g || !s) {
          // 曲が消えている記録は掃除して、通常の入口のままにする
          clearLastSession()
          return
        }
        const o = { id: g.id, name: g.name }
        setOrg(o)
        loadUrl(last.songId)
        setFileName(s.title)
        setFileKey(last.songId)
        setFileLoaded(true)
        setScreen('player', true)
        lastSessionRef.current = { orgId: g.id, songId: last.songId, title: s.title, position: last.position, savedAt: last.savedAt }
        if (last.position > 3) restorePositionRef.current = last.position
      })
      .catch(() => { /* リンク解決に失敗したら通常の入口のまま */ })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Space キーで再生/停止 ────────────────────────────────────────────────
  const togglePlayPauseRef = useRef(togglePlayPause)
  useEffect(() => { togglePlayPauseRef.current = togglePlayPause }, [togglePlayPause])

  useEffect(() => {
    if (screen !== 'player') return
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      e.preventDefault()
      togglePlayPauseRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [screen])

  const handleFileSelect = (url: string, key: string, name: string) => {
    loadUrl(url)
    setFileName(name)
    setFileKey(key)
    setFileLoaded(true)
    setScreen('player')
    setFileLoadCounter((c) => c + 1)
    importSections([])
    if (org) rememberSong(org.id, key, name)
  }

  // 曲データ編集の保存後: 新しい構成でプレイヤーを読み込み直す
  const handleSongSaved = (newTitle: string) => {
    setFileName(newTitle)
    setMixerKey(k => k + 1)
    if (fileKey) loadUrl(fileKey)
  }

  const handleSongDeleted = () => {
    setFileLoaded(false)
    setFileName('')
    setFileKey(null)
    importSections([])
    setScreen('files')
    // 消した曲が「最後に開いていた曲」なら、復元対象からも外す
    if (lastSessionRef.current && fileKey && lastSessionRef.current.songId === fileKey) {
      lastSessionRef.current = null
      clearLastSession()
    }
  }

  const handleSectionLabelClick = (id: string) => {
    selectMarker(id)
    setScrollTarget((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }))
  }

  // 選択中の範囲 {開始マーカー, 終了マーカー, 開始時刻, 実効終了時刻} を
  // ref の最新値から組み立てる単一の出所。実効終了時刻は「終了マーカーの区間の
  // 終わり」（＝その次のマーカーの開始、無ければ曲末。endTime がそれを保持する）。
  // 終了マーカー未選択なら開始マーカー自身の区間が実効範囲になる。
  // 終了マーカーが開始より後ろに無い（並びが変わった等）場合は未選択として扱う
  const resolveRange = useCallback(() => {
    const sorted = [...sections].sort((a, b) => a.startTime - b.startTime)
    const sIdx = sorted.findIndex(s => s.id === activeSectionIdRef.current)
    if (sIdx < 0) return null
    const startSec = sorted[sIdx]
    let endSec = startSec
    const endId = rangeEndIdRef.current
    if (endId) {
      const eIdx = sorted.findIndex(s => s.id === endId)
      if (eIdx > sIdx) endSec = sorted[eIdx]
    }
    const end = endSec.endTime > endSec.startTime ? endSec.endTime : duration
    return { startSec, endSec, start: startSec.startTime, end }
  }, [sections, duration])

  // 編集モード用マーカー再生: そのマーカー自身の区間を鳴らす
  // （FlagEditor の「終わり際」プレビューは endTime を渡してくる）
  const playMarker = useCallback((startTime: number, endTime: number) => {
    const sorted = [...sections].sort((a, b) => a.startTime - b.startTime)
    const idx = sorted.findIndex(s => Math.abs(s.startTime - startTime) < 0.01)
    const sec = idx >= 0 ? sorted[idx] : null
    if (sec) selectMarker(sec.id)
    let end = endTime > startTime ? endTime : NaN
    if (!Number.isFinite(end)) {
      end = sec && sec.endTime > startTime ? sec.endTime : duration
    }
    playSection(startTime, end)
  }, [sections, duration, playSection, selectMarker])

  // 再生モード: 開始行（選択中マーカーの行）の再生ボタンだけが範囲再生の入口。
  // 範囲 {開始, 実効終了, ループ} をここで確定し、playSection で武装する
  const playSelectedRange = useCallback(() => {
    const r = resolveRange()
    if (!r) return
    playSection(r.start, r.end, { loop: rangeLoopRef.current })
  }, [resolveRange, playSection])

  // 「ここまで」: 終了マーカーの指定・差し替え（選択自体は動かさない）
  const chooseRangeEnd = useCallback((id: string) => {
    const sorted = [...sections].sort((a, b) => a.startTime - b.startTime)
    const sIdx = sorted.findIndex(s => s.id === activeSectionIdRef.current)
    const eIdx = sorted.findIndex(s => s.id === id)
    if (sIdx >= 0 && eIdx > sIdx) applyRangeEnd(id)
  }, [sections, applyRangeEnd])

  // 範囲DL: 現在の実効範囲を今のバランスで切り取って MP3 で保存する
  const downloadSelectedRange = useCallback(async () => {
    const r = resolveRange()
    if (!r) return
    const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'マーカー'
    const rangeName = r.endSec === r.startSec
      ? sanitize(r.startSec.label)
      : `${sanitize(r.startSec.label)}-${sanitize(r.endSec.label)}`
    await downloadRangeMix(`${fileName ? fileName + '_' : ''}${rangeName}`, r.start, r.end)
  }, [resolveRange, fileName])

  const handleAddSection = () => {
    const start = currentTime
    const end = Math.min(currentTime + 30, duration || currentTime + 30)
    const id = addSection(start, end)
    selectMarker(id)
  }

  const handleMarkStart = () => {
    if (!activeSectionId) return
    const sec = sections.find((s) => s.id === activeSectionId)
    if (!sec) return
    // マーカーの開始位置は [0, 曲の尺] だけに制限し、隣のマーカーの追い越しを許可する
    const t = duration > 0 ? Math.min(currentTime, duration) : currentTime
    updateSection(activeSectionId, { startTime: Math.max(0, t) })
  }

  const handleMarkEnd = () => {
    if (!activeSectionId) return
    const sec = sections.find((s) => s.id === activeSectionId)
    if (!sec) return
    updateSection(activeSectionId, { startTime: Math.max(currentTime, sec.startTime + 0.1) })
  }

  // Close wave menu when clicking outside
  useEffect(() => {
    if (!waveMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (waveMenuRef.current && !waveMenuRef.current.contains(e.target as Node)) {
        setWaveMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [waveMenuOpen])

  const handleLogout = () => {
    // 団体から戻るだけ。管理者ログイン（localStorage）は保持する
    setOrg(null)
    setScreen('auth')
    setFileLoaded(false)
    setFileName('')
    setFileKey(null)
    importSections([])
  }

  return (
    <>
      <audio ref={audioRef} />

      {screen === 'auth' && (
        <AuthPage
          onAuth={(o) => { setOrg(o); setScreen('files') }}
          onAdmin={() => setScreen('admin')}
        />
      )}

      {screen === 'admin' && <AdminPage onLogout={handleLogout} />}

      {screen === 'files' && org && (
        <FileListPage
          org={org}
          onFileSelect={handleFileSelect}
          onLogout={handleLogout}
          isAdmin={isAdmin}
        />
      )}

      {screen === 'player' && (
        <div className="app">
          <header className="app-header">
            <span className="app-title">
              <div className="wave-menu-wrapper" ref={waveMenuRef}>
                <button
                  className="waveform-gen-btn"
                  onClick={fileKey ? () => setWaveMenuOpen((v) => !v) : undefined}
                  title={fileKey ? 'メニュー' : '（ファイル未選択）'}
                  disabled={!fileKey}
                >≡</button>
                {waveMenuOpen && fileKey && (
                  <div className="wave-menu">
                    <button
                      className="wave-menu-item"
                      onClick={() => {
                        const url = buildAppShareUrl(fileKey)
                        navigator.clipboard.writeText(url).then(() => alert('URLをコピーしました'))
                        setWaveMenuOpen(false)
                      }}
                    >
                      🔗 曲URL共有
                    </button>
                  </div>
                )}
              </div>
              {org
                ? <button className="org-name-link" onClick={() => setScreen('files')} title="ファイル一覧へ">{org.name}</button>
                : 'MultiPlay'
              }
            </span>
            <ModeSelector mode={mode} onChange={setMode} showEdit />
          </header>

          {fileLoaded && (
            <div className="player">
              <div className="file-bar">
                <span className="file-name" title={fileName}>{fileName}</span>
                <div className="time-display">
                  <span className="current-time">{formatTime(currentTime)}</span>
                  <span className="time-sep">/</span>
                  <span className="total-time">{formatTime(duration)}</span>
                  {fileKey && (
                    <span
                      className={`sync-indicator${isDirty ? ' sync-dirty' : ' sync-clean'}`}
                      title={lastSyncedAt ? `最終同期: ${lastSyncedAt.toLocaleTimeString('ja-JP')}` : '未同期'}
                    >
                      ☁ {lastSyncedAt ? lastSyncedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                    </span>
                  )}
                </div>
              </div>

              {(loadState.status === 'loading' || loadState.status === 'error') && (
                <div className="mp-loading-overlay">
                  <div className="mp-loading-box">
                    {loadState.status === 'loading' ? (
                      <>
                        <div className="mp-loading-title">読み込み中…</div>
                        <div className="mp-loading-phase">
                          {loadState.phase}
                          {loadState.total > 0 && `（${loadState.done} / ${loadState.total} トラック）`}
                        </div>
                        <div className="mp-gauge">
                          {loadState.total > 0
                            ? <div className="mp-gauge-fill" style={{ width: `${Math.round((loadState.done / loadState.total) * 100)}%` }} />
                            : <div className="mp-gauge-fill indeterminate" />}
                        </div>
                        <div className="mp-loading-note">波形と音声の準備が終わるまで、再生・操作はできません</div>
                      </>
                    ) : (
                      <>
                        <div className="mp-loading-title">読み込みに失敗しました</div>
                        <div className="mp-loading-phase">{loadState.error}</div>
                        <button className="mp-btn" onClick={() => setScreen('files')}>曲一覧へ戻る</button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {pendingRate !== null && !rateProcessing && loadState.status === 'ready' && (
                <div className="mp-rate-banner" role="alert">
                  <div className="mp-rate-banner-text">
                    速度変更を確定しますか？
                    <span className="mp-rate-banner-detail">
                      {Math.round(pendingRate * 100)}%・ピッチ維持（確定するまで今の速度で再生します）
                    </span>
                  </div>
                  <button className="mp-btn primary mp-rate-confirm" onClick={confirmRateChange}>確定する</button>
                </div>
              )}

              {rateError && !rateProcessing && (
                <div className="mp-rate-banner mp-rate-banner-error">
                  <div className="mp-rate-banner-text">
                    速度変更の準備に失敗しました
                    <span className="mp-rate-banner-detail">{rateError}</span>
                  </div>
                </div>
              )}

              {rateProcessing && (
                <div className="mp-loading-overlay">
                  <div className="mp-loading-box">
                    <div className="mp-loading-title">速度変更を準備中…</div>
                    <div className="mp-loading-phase">
                      ピッチを保ったまま音声を作り直しています
                      {rateProcessing.total > 0 && `（${rateProcessing.done} / ${rateProcessing.total} トラック）`}
                    </div>
                    <div className="mp-gauge">
                      {rateProcessing.total > 0
                        ? <div className="mp-gauge-fill" style={{ width: `${Math.round((rateProcessing.done / rateProcessing.total) * 100)}%` }} />
                        : <div className="mp-gauge-fill indeterminate" />}
                    </div>
                    <div className="mp-loading-note">終わるまで今の速度で再生が続きます</div>
                  </div>
                </div>
              )}

              <TrackSeekBar
                currentTime={currentTime}
                duration={duration}
                sections={sections}
                mode={mode}
                activeSectionId={activeSectionId}
                rangeEndId={rangeEndId}
                onSeek={seek}
                onSectionUpdate={updateSection}
                onSectionLabelClick={handleSectionLabelClick}
              />

              {mode !== 'settings' && (
                <PlaybackControls
                  isPlaying={isPlaying}
                  mode={mode}
                  currentTime={currentTime}
                  sections={sections}
                  playbackRate={playbackRate}
                  onToggle={togglePlayPause}
                  onSkip={skip}
                  onSeek={seek}
                  onPlaybackRateChange={changePlaybackRate}
                  skipValues={settings.skipValues}
                  activeSectionId={activeSectionId}
                  onMarkStart={handleMarkStart}
                  onMarkEnd={handleMarkEnd}
                  markerMode
                />
              )}

              {mode === 'edit' && fileKey && isAdmin && (
                <SongEditPanel
                  songId={fileKey}
                  isPlaying={isPlaying}
                  onSaved={handleSongSaved}
                  onTitleSaved={setFileName}
                  onDeleted={handleSongDeleted}
                />
              )}

              {mode !== 'settings' && (
                <SectionList
                  sections={sections}
                  mode={mode}
                  duration={duration}
                  audioSrc={src ?? ''}
                  editAdjustValues={settings.editAdjustValues}
                  currentTime={currentTime}
                  activeSectionId={activeSectionId}
                  onPlay={playMarker}
                  rangeEndId={rangeEndId}
                  rangeLoop={rangeLoop}
                  onChooseRangeEnd={chooseRangeEnd}
                  onToggleRangeLoop={() => applyRangeLoop(!rangeLoopRef.current)}
                  onPlayRange={playSelectedRange}
                  onDownloadRange={downloadSelectedRange}
                  onUpdate={updateSection}
                  onDelete={deleteSection}
                  onActivate={selectMarker}
                  scrollTarget={scrollTarget}
                  fileName={fileName}
                  onAddSection={handleAddSection}
                  onUndo={undo}
                  onRedo={redo}
                  undoCount={undoCount}
                  redoCount={redoCount}
                  markerMode
                />
              )}

              {/* リバーブ調整はミキサーの真上、トラック音量は画面の最下段 */}
              {mode === 'play' && fileKey && <ReverbControl />}
              {mode === 'play' && fileKey && (
                <TrackMixer key={`${fileKey}:${mixerKey}`} songId={fileKey} />
              )}

              {mode === 'settings' && (
                <div className="settings-scroll">
                  <SettingsPanel settings={settings} onUpdate={updateSettings} pitchKeep={pitchKeep} onPitchKeepChange={setPitchKeep} />
                  <AudioCachePanel />
                  <TutorialSettings />
                  <div className="cache-panel mp-install-panel">
                    <div className="cache-panel-title">アプリとしてインストール</div>
                    <p className="cache-panel-text">
                      ホーム画面に追加すると、アプリのようにすぐ開けます。
                    </p>
                    <PwaInstallButton />
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </>
  )
}
