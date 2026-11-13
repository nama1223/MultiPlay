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
import { SettingsPanel } from './components/SettingsPanel'
import { AuthPage } from './components/AuthPage'
import { FileListPage } from './components/FileListPage'
import { AdminPage } from './components/AdminPage'
import { TrackMixer } from './components/TrackMixer'
import { SongEditPanel } from './components/SongEditPanel'
import { AudioCachePanel } from './components/AudioCachePanel'
import { PwaInstallButton } from './components/PwaInstallButton'
import { formatTime } from './utils/timeFormat'
import { AppMode, Section } from './types'
import { buildAppShareUrl, indexUrl } from './config'
import type { MpIndex } from './multiplay/types'
import './App.css'
import './multiplay2.css'

type Screen = 'auth' | 'files' | 'admin' | 'player'

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
  const [fileLoadCounter, setFileLoadCounter] = useState(0)
  const [scrollTarget, setScrollTarget] = useState<{ id: string; seq: number } | null>(null)

  const {
    audioRef, currentTime, duration, isPlaying, src,
    togglePlayPause, seek, skip, playSection,
    loadUrl,
    playbackRate, changePlaybackRate, loadState,
    pitchKeep, setPitchKeep, pendingRate, confirmRateChange, rateProcessing, rateError,
  } = useAudioPlayer()
  const [mixerKey, setMixerKey] = useState(0)

  const { sections, addSection, updateSection, deleteSection, importSections, undo, redo, undoCount, redoCount } = useSections()
  const { settings, updateSettings } = useSettings()
  // 管理者ログイン（localStorage に保存）があれば「編集」モードを解放する
  const [isAdmin, setIsAdmin] = useState(() => !!localStorage.getItem('mp_admin_token'))
  useEffect(() => {
    setIsAdmin(!!localStorage.getItem('mp_admin_token'))
  }, [screen])
  useEffect(() => {
    if (!isAdmin && mode === 'edit') setMode('play')
  }, [isAdmin, mode])
  const [waveMenuOpen, setWaveMenuOpen] = useState(false)
  const waveMenuRef = useRef<HTMLDivElement>(null)
  const onRemoteUpdate = useCallback((secs: Section[]) => importSections(secs), [importSections])
  const { lastSyncedAt, isDirty } = useSectionSync(fileKey, fileLoadCounter, mode, sections, onRemoteUpdate)

  // ── ?g=（団体リンク）/ ?song=（曲リンク）パラメータ ─────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gParam = params.get('g')
    const songParam = params.get('song')
    if (!gParam && !songParam) return

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
        }
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
  }

  const handleSectionLabelClick = (id: string) => {
    setActiveSectionId(id)
    setScrollTarget((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }))
  }

  // マーカー再生: 終了位置は「次のマーカー（なければ曲末）」を常に正とする
  const playMarker = useCallback((startTime: number, _endTime: number) => {
    const sorted = [...sections].sort((a, b) => a.startTime - b.startTime)
    const idx = sorted.findIndex(s => Math.abs(s.startTime - startTime) < 0.01)
    const end = idx >= 0 && idx + 1 < sorted.length ? sorted[idx + 1].startTime : duration
    playSection(startTime, end)
  }, [sections, duration, playSection])

  const handleAddSection = () => {
    const start = currentTime
    const end = Math.min(currentTime + 30, duration || currentTime + 30)
    const id = addSection(start, end)
    setActiveSectionId(id)
  }

  const handleMarkStart = () => {
    if (!activeSectionId) return
    const sec = sections.find((s) => s.id === activeSectionId)
    if (!sec) return
    updateSection(activeSectionId, { startTime: Math.min(currentTime, sec.endTime - 0.1) })
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
            <ModeSelector mode={mode} onChange={setMode} showEdit={isAdmin} />
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

              {mode === 'play' && fileKey && (
                <TrackMixer key={`${fileKey}:${mixerKey}`} songId={fileKey} />
              )}

              {mode === 'edit' && fileKey && (
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
                  onUpdate={updateSection}
                  onDelete={deleteSection}
                  onActivate={setActiveSectionId}
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

              {mode === 'settings' && (
                <>
                  <SettingsPanel settings={settings} onUpdate={updateSettings} pitchKeep={pitchKeep} onPitchKeepChange={setPitchKeep} />
                  <AudioCachePanel />
                  <div className="cache-panel mp-install-panel">
                    <div className="cache-panel-title">アプリとしてインストール</div>
                    <p className="cache-panel-text">
                      ホーム画面に追加すると、アプリのようにすぐ開けます。
                    </p>
                    <PwaInstallButton />
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      )}
    </>
  )
}
