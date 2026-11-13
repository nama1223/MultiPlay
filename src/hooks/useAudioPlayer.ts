import { useRef, useState, useCallback, useEffect } from 'react'
import { engine, setCurrentManifest } from '../multiplay/bridge'
import { songUrl, resolveTrackUrl } from '../config'
import type { MpSongManifest } from '../multiplay/types'

const RATE_MIN = 0.5
const RATE_MAX = 2.0
export const RATE_STEP = 0.05

/** ピッチ維持トグルの保存キー（既定 ON） */
const PITCH_KEEP_KEY = 'mp_pitch_keep_v1'

function loadPitchKeep(): boolean {
  try { return localStorage.getItem(PITCH_KEEP_KEY) !== '0' } catch { return true }
}

export interface RateProcessing {
  done: number
  total: number
}

export interface LoadState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  phase: string
  done: number
  total: number
  error: string
}

/**
 * RecPlay の useAudioPlayer と同じインターフェースを、多トラックエンジンで実装する。
 * loadUrl には曲IDを渡す（manifest を取得して全トラックを読み込む）。
 */
export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [playbackRate, setPlaybackRate] = useState(1.0)
  const playbackRateRef = useRef(1.0)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle', phase: '', done: 0, total: 0, error: '' })
  const loadReadyRef = useRef(false)

  // ── 速度まわりの状態 ──────────────────────────────────────────────
  // playbackRate = ユーザーが選んだ「目標の速度」。実際に鳴っている速度は appliedRate。
  // ピッチ維持 ON のときは目標と適用がずれると「確定待ち」になり、確定で伸縮処理が走る。
  const [pitchKeep, setPitchKeepState] = useState<boolean>(loadPitchKeep)
  const pitchKeepRef = useRef(pitchKeep)
  const [appliedRate, setAppliedRate] = useState(1.0)
  const appliedRateRef = useRef(1.0)
  /** 適用中の方式: 'rate' = playbackRate 方式 / 'stretch' = 時間伸縮バッファ */
  const appliedModeRef = useRef<'rate' | 'stretch'>('rate')
  const [pendingRate, setPendingRate] = useState<number | null>(null)
  const [rateProcessing, setRateProcessing] = useState<RateProcessing | null>(null)
  const [rateError, setRateError] = useState('')
  const rateBusyRef = useRef(false)

  /** 目標・適用・方式から「確定待ち」かどうかを再計算する */
  const recomputePending = useCallback(() => {
    const target = playbackRateRef.current
    let pending: number | null = null
    if (pitchKeepRef.current) {
      if (appliedModeRef.current === 'stretch') {
        pending = target !== appliedRateRef.current ? target : null
      } else {
        // 従来方式で鳴っている間は、等倍以外すべて伸縮の確定待ち。
        // 適用中と同値に戻しても方式が違うので確定待ちのまま（等倍は同一扱い）。
        pending = target !== appliedRateRef.current || target !== 1 ? target : null
      }
    }
    setPendingRate(pending)
  }, [])

  /**
   * 武装中の範囲 {開始, 終了, ループ}。範囲の出所はここだけ:
   * playSection が再生開始時に確定（arm）し、終了監視はこの ref だけを見る。
   * 本体の再生/シーク/スキップや、マーカー選択の変更では解除（disarm）される。
   */
  const armedRangeRef = useRef<{ start: number; end: number; loop: boolean } | null>(null)

  // 再生位置のポーリング（マーカー再生の終了位置もここで見る）
  useEffect(() => {
    let prev = 0
    const id = setInterval(() => {
      const t = engine.position()
      setCurrentTime(t)
      setIsPlaying(engine.playing)
      if (!engine.playing) { prev = t; return }
      const armed = armedRangeRef.current
      // 終了位置を「跨いだ」瞬間だけ反応する（終了より後ろから再生し直した時に巻き戻らないように）
      if (armed && prev < armed.end && t >= armed.end) {
        if (armed.loop) {
          engine.seek(armed.start)
          prev = armed.start
          setCurrentTime(armed.start)
          return
        }
        engine.pause()
        armedRangeRef.current = null
      }
      prev = t
    }, 100)
    return () => clearInterval(id)
  }, [])

  /** 範囲の武装を解除する（本体操作・選択変更・曲の読み込みで使う） */
  const clearRange = useCallback(() => {
    armedRangeRef.current = null
  }, [])

  const togglePlayPause = useCallback(() => {
    if (!loadReadyRef.current) return
    // 本体ボタンからの再生は曲全体の再生。古い範囲が残っていて
    // 途中で止まる/巻き戻ることが無いよう、必ず解除してから切り替える
    armedRangeRef.current = null
    engine.toggle()
    setIsPlaying(engine.playing)
  }, [])

  const seek = useCallback((time: number) => {
    if (!loadReadyRef.current) return
    armedRangeRef.current = null
    engine.seek(time)
    setCurrentTime(engine.position())
  }, [])

  const skip = useCallback((delta: number) => {
    if (!loadReadyRef.current) return
    armedRangeRef.current = null
    engine.seek(engine.position() + delta)
    setCurrentTime(engine.position())
  }, [])

  const playSection = useCallback((startTime: number, endTime: number, opts?: { loop?: boolean }) => {
    if (!loadReadyRef.current) return
    // 再生開始時に範囲をここへ確定する。以後の監視はこの値だけを見る
    armedRangeRef.current = { start: startTime, end: endTime, loop: !!opts?.loop }
    engine.play(startTime)
    setIsPlaying(true)
  }, [])

  /** ピッチ維持で目標速度を適用する（全トラックを伸縮して差し替え）。target=1 は原音へ戻す */
  const applyStretched = useCallback(async (target: number) => {
    if (rateBusyRef.current) return
    if (!engine.stretchTempo && target === 1) {
      engine.setRate(1)
      appliedRateRef.current = 1
      appliedModeRef.current = 'rate'
      setAppliedRate(1)
      setPendingRate(null)
      return
    }
    rateBusyRef.current = true
    setRateError('')
    setRateProcessing({ done: 0, total: engine.tracks.length })
    try {
      await engine.rebuildBuffers(target === 1 ? null : target, resolveTrackUrl, (done, total) => {
        setRateProcessing({ done, total })
      })
      appliedRateRef.current = target
      appliedModeRef.current = target === 1 ? 'rate' : 'stretch'
      setAppliedRate(target)
      setDuration(engine.duration)
      setCurrentTime(engine.position())
      if (playbackRateRef.current === target) setPendingRate(null)
      else recomputePending()
    } catch (e) {
      console.error('速度変更の準備に失敗', e)
      setRateError(e instanceof Error ? e.message : String(e))
    } finally {
      rateBusyRef.current = false
      setRateProcessing(null)
    }
  }, [recomputePending])

  /** 伸縮を解除し、従来方式（playbackRate）で目標速度を即適用する */
  const applyClassic = useCallback(async (target: number) => {
    if (rateBusyRef.current) return
    if (!engine.stretchTempo) {
      engine.setRate(target)
      appliedRateRef.current = target
      appliedModeRef.current = 'rate'
      setAppliedRate(target)
      setPendingRate(null)
      return
    }
    rateBusyRef.current = true
    setRateError('')
    setRateProcessing({ done: 0, total: engine.tracks.length })
    try {
      await engine.rebuildBuffers(null, resolveTrackUrl, (done, total) => {
        setRateProcessing({ done, total })
      })
      engine.setRate(playbackRateRef.current)
      appliedRateRef.current = playbackRateRef.current
      appliedModeRef.current = 'rate'
      setAppliedRate(playbackRateRef.current)
      setDuration(engine.duration)
      setCurrentTime(engine.position())
      setPendingRate(null)
    } catch (e) {
      console.error('速度変更の準備に失敗', e)
      setRateError(e instanceof Error ? e.message : String(e))
    } finally {
      rateBusyRef.current = false
      setRateProcessing(null)
    }
  }, [])

  const pendingRateRef = useRef<number | null>(null)
  useEffect(() => { pendingRateRef.current = pendingRate }, [pendingRate])

  /** 「確定する」ボタン: 確定待ちの速度を伸縮で適用する */
  const confirmRateChange = useCallback(() => {
    const pending = pendingRateRef.current
    if (pending !== null) void applyStretched(pending)
  }, [applyStretched])

  /** ピッチ維持トグルの切替（localStorage に保持） */
  const setPitchKeep = useCallback((v: boolean) => {
    pitchKeepRef.current = v
    setPitchKeepState(v)
    try { localStorage.setItem(PITCH_KEEP_KEY, v ? '1' : '0') } catch { /* noop */ }
    if (rateBusyRef.current) { recomputePending(); return }
    if (!v) {
      // OFF にしたら従来方式へ即戻す（伸縮中なら原音へ差し替えてから）
      void applyClassic(playbackRateRef.current)
    } else {
      recomputePending()
    }
  }, [applyClassic, recomputePending])

  const loadFile = useCallback((_file: File) => {
    // MultiPlay ではローカルファイルの直接再生は使わない
  }, [])

  const loadUrl = useCallback((songId: string) => {
    setSrc(songId)
    setCurrentTime(0)
    setDuration(0)
    setRateError('')
    armedRangeRef.current = null
    loadReadyRef.current = false
    setLoadState({ status: 'loading', phase: '曲データを取得中…', done: 0, total: 0, error: '' })
    ;(async () => {
      try {
        const res = await fetch(songUrl(songId))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const manifest = (await res.json()) as MpSongManifest
        setCurrentManifest(manifest)
        // 波形ピーク付きの曲データなら、総時間を先に表示する（波形の先行表示と対）
        const est = manifest.tracks.reduce((m, t) => Math.max(m, (t.offsetMs ?? 0) / 1000 + (t.durationSec ?? 0)), 0)
        if (est > 0) setDuration(est)
        setLoadState({ status: 'loading', phase: '音声を読み込み中…', done: 0, total: manifest.tracks.length, error: '' })
        await engine.load(manifest.tracks, resolveTrackUrl, (done, total) => {
          setLoadState({ status: 'loading', phase: '音声を読み込み中…', done, total, error: '' })
        })
        if (pitchKeepRef.current && playbackRateRef.current !== 1) {
          // ピッチ維持 ON で速度が等倍でないまま曲を開いたら、その速度で伸縮してから使えるようにする
          const rate = playbackRateRef.current
          setLoadState({ status: 'loading', phase: '速度変更を準備中…', done: 0, total: manifest.tracks.length, error: '' })
          await engine.rebuildBuffers(rate, resolveTrackUrl, (done, total) => {
            setLoadState({ status: 'loading', phase: '速度変更を準備中…', done, total, error: '' })
          })
          appliedRateRef.current = rate
          appliedModeRef.current = 'stretch'
          setAppliedRate(rate)
        } else {
          engine.setRate(playbackRateRef.current)
          appliedRateRef.current = playbackRateRef.current
          appliedModeRef.current = 'rate'
          setAppliedRate(playbackRateRef.current)
        }
        setPendingRate(null)
        setDuration(engine.duration)
        loadReadyRef.current = true
        setLoadState({ status: 'ready', phase: '', done: manifest.tracks.length, total: manifest.tracks.length, error: '' })
      } catch (e) {
        console.error('曲の読み込みに失敗', e)
        setLoadState({ status: 'error', phase: '', done: 0, total: 0, error: e instanceof Error ? e.message : String(e) })
      }
    })()
  }, [])

  const changePlaybackRate = useCallback((delta: number) => {
    const next = Math.round((playbackRateRef.current + delta) * 100) / 100
    const clamped = Math.max(RATE_MIN, Math.min(RATE_MAX, next))
    playbackRateRef.current = clamped
    setPlaybackRate(clamped)
    if (pitchKeepRef.current) {
      // ピッチ維持 ON: 即座には再構成しない。「確定待ち」にするだけ（再生は旧速度のまま）
      recomputePending()
      return
    }
    if (rateBusyRef.current) return
    if (engine.stretchTempo) { void applyClassic(clamped); return }
    engine.setRate(clamped)
    appliedRateRef.current = clamped
    appliedModeRef.current = 'rate'
    setAppliedRate(clamped)
    setPendingRate(null)
  }, [applyClassic, recomputePending])

  return {
    audioRef,
    currentTime,
    duration,
    isPlaying,
    src,
    playbackRate,
    togglePlayPause,
    seek,
    skip,
    playSection,
    clearRange,
    loadFile,
    loadUrl,
    loadState,
    changePlaybackRate,
    pitchKeep,
    setPitchKeep,
    appliedRate,
    pendingRate,
    confirmRateChange,
    rateProcessing,
    rateError,
  }
}
