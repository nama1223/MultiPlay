import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useSections } from './hooks/useSections'
import { useSeekBar } from './hooks/useSeekBar'
import { useSettings } from './hooks/useSettings'
import { useWaveform } from './hooks/useWaveform'
import { useSectionSync } from './hooks/useSectionSync'
import { OrgInfo, getStoredOrgs, storeOrg } from './hooks/useOrgAuth'
import { SeekBar } from './components/SeekBar/SeekBar'
import { PlaybackControls } from './components/Controls/PlaybackControls'
import { SectionList } from './components/Sections/SectionList'
import { ModeSelector } from './components/ModeSelector'
import { SettingsPanel } from './components/SettingsPanel'
import { AuthPage } from './components/AuthPage'
import { FileListPage } from './components/FileListPage'
import { AdminPage } from './components/AdminPage'
import { TrackMixer } from './components/TrackMixer'
import { formatTime } from './utils/timeFormat'
import { AppMode, Section, ZOOM_LEVELS } from './types'
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
    loadUrl, setExcludedZones, setSkipExcluded,
    playbackRate, changePlaybackRate,
  } = useAudioPlayer()

  const { sections, addSection, updateSection, deleteSection, toggleExclude, importSections, reorderSections, undo, redo, undoCount, redoCount } = useSections()
  const { zoomIndex, zoomIn, zoomOut, secondsPerRow, numRows, initZoom } = useSeekBar(duration)
  const { settings, updateSettings } = useSettings()
  const { samples: waveformSamples, hasStored: waveformStored, peakLevel: waveformPeakLevel } = useWaveform(src, duration, fileKey)
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

  useEffect(() => {
    if (duration > 0) initZoom(duration)
  }, [duration, initZoom])

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

  useEffect(() => {
    const excluded = sections.filter((s) => s.isExcluded).map((s) => ({ start: s.startTime, end: s.endTime }))
    setExcludedZones(excluded)
  }, [sections, setExcludedZones])

  useEffect(() => {
    setSkipExcluded(mode === 'play')
  }, [mode, setSkipExcluded])

  const handleFileSelect = (url: string, key: string, name: string) => {
    loadUrl(url)
    setFileName(name)
    setFileKey(key)
    setFileLoaded(true)
    setScreen('player')
    setFileLoadCounter((c) => c + 1)
    importSections([])
  }

  const handleSectionLabelClick = (id: string) => {
    setActiveSectionId(id)
    setScrollTarget((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }))
  }

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
    sessionStorage.removeItem('mp_admin_token')
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
            <ModeSelector mode={mode} onChange={setMode} />
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

              <div className="zoom-row">
                <button className="zoom-btn-sm" onClick={zoomOut} disabled={zoomIndex === ZOOM_LEVELS.length - 1} title="ズームアウト">−</button>
                <span className="zoom-label-sm">{secondsPerRow >= 60 ? `${secondsPerRow / 60}分/段` : `${secondsPerRow}秒/段`}</span>
                <button className="zoom-btn-sm" onClick={zoomIn} disabled={zoomIndex === 0} title="ズームイン">＋</button>
              </div>

              <SeekBar
                currentTime={currentTime}
                duration={duration}
                secondsPerRow={secondsPerRow}
                numRows={numRows}
                sections={sections}
                mode={mode}
                waveformSamples={waveformSamples}
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
                />
              )}

              {mode !== 'settings' && fileKey && (
                <TrackMixer songId={fileKey} />
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
                  onPlay={playSection}
                  onUpdate={updateSection}
                  onDelete={deleteSection}
                  onToggleExclude={toggleExclude}
                  onActivate={setActiveSectionId}
                  scrollTarget={scrollTarget}
                  hasWaveform={waveformStored && !!waveformPeakLevel}
                  fileName={fileName}
                  onAddSection={handleAddSection}
                  onUndo={undo}
                  onRedo={redo}
                  undoCount={undoCount}
                  redoCount={redoCount}
                  onReorder={reorderSections}
                  onSectionNormalized={() => { /* MultiPlay では未対応 */ }}
                  onNormalizeAll={undefined}
                  normalizeAllActive={false}
                />
              )}

              {mode === 'settings' && (
                <SettingsPanel settings={settings} onUpdate={updateSettings} />
              )}
            </div>
          )}

        </div>
      )}
    </>
  )
}
