import { useRef, useState, useCallback, useEffect } from 'react'
import { ExcludedZone } from '../types'
import { engine, setCurrentManifest } from '../multiplay/bridge'
import { songUrl, resolveTrackUrl } from '../config'
import type { MpSongManifest } from '../multiplay/types'

const RATE_MIN = 0.5
const RATE_MAX = 2.0
export const RATE_STEP = 0.05

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

  const sectionEndRef = useRef<number | null>(null)
  const excludedZonesRef = useRef<ExcludedZone[]>([])
  const skipExcludedRef = useRef(false)

  // 再生位置のポーリング（区間終了・除外区間のスキップもここで見る）
  useEffect(() => {
    const id = setInterval(() => {
      const t = engine.position()
      setCurrentTime(t)
      setIsPlaying(engine.playing)
      if (!engine.playing) return
      if (sectionEndRef.current !== null && t >= sectionEndRef.current) {
        engine.pause()
        sectionEndRef.current = null
        return
      }
      if (skipExcludedRef.current) {
        for (const zone of excludedZonesRef.current) {
          if (t >= zone.start && t < zone.end) {
            engine.seek(zone.end)
            return
          }
        }
      }
    }, 100)
    return () => clearInterval(id)
  }, [])

  const togglePlayPause = useCallback(() => {
    engine.toggle()
    setIsPlaying(engine.playing)
  }, [])

  const seek = useCallback((time: number) => {
    engine.seek(time)
    setCurrentTime(engine.position())
  }, [])

  const skip = useCallback((delta: number) => {
    // 除外区間を考慮したスキップ（元の実装と同じ計算）
    if (!skipExcludedRef.current || excludedZonesRef.current.length === 0) {
      engine.seek(engine.position() + delta)
      setCurrentTime(engine.position())
      return
    }
    const zones = [...excludedZonesRef.current].sort((a, b) => a.start - b.start)
    const dur = engine.duration
    let pos = engine.position()
    let remaining = Math.abs(delta)
    if (delta > 0) {
      for (const zone of zones) {
        if (zone.end <= pos) continue
        const from = Math.max(zone.start, pos)
        if (from > pos) {
          const gap = from - pos
          if (gap >= remaining) { pos += remaining; remaining = 0; break }
          remaining -= gap
        }
        pos = zone.end
      }
      if (remaining > 0) pos += remaining
      pos = Math.min(pos, dur)
    } else {
      for (const zone of [...zones].reverse()) {
        if (zone.start >= pos) continue
        const to = Math.min(zone.end, pos)
        if (to < pos) {
          const gap = pos - to
          if (gap >= remaining) { pos -= remaining; remaining = 0; break }
          remaining -= gap
        }
        pos = zone.start
      }
      if (remaining > 0) pos -= remaining
      pos = Math.max(pos, 0)
    }
    engine.seek(pos)
    setCurrentTime(engine.position())
  }, [])

  const playSection = useCallback((startTime: number, endTime: number) => {
    sectionEndRef.current = endTime
    engine.play(startTime)
    setIsPlaying(true)
  }, [])

  const loadFile = useCallback((_file: File) => {
    // MultiPlay ではローカルファイルの直接再生は使わない
  }, [])

  const loadUrl = useCallback((songId: string) => {
    setSrc(songId)
    setCurrentTime(0)
    setDuration(0)
    sectionEndRef.current = null
    ;(async () => {
      try {
        const res = await fetch(songUrl(songId))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const manifest = (await res.json()) as MpSongManifest
        setCurrentManifest(manifest)
        await engine.load(manifest.tracks, resolveTrackUrl)
        engine.setRate(playbackRateRef.current)
        setDuration(engine.duration)
      } catch (e) {
        console.error('曲の読み込みに失敗', e)
      }
    })()
  }, [])

  const setExcludedZones = useCallback((zones: ExcludedZone[]) => {
    excludedZonesRef.current = zones
  }, [])

  const setSkipExcluded = useCallback((val: boolean) => {
    skipExcludedRef.current = val
  }, [])

  const changePlaybackRate = useCallback((delta: number) => {
    const next = Math.round((playbackRateRef.current + delta) * 100) / 100
    const clamped = Math.max(RATE_MIN, Math.min(RATE_MAX, next))
    playbackRateRef.current = clamped
    setPlaybackRate(clamped)
    engine.setRate(clamped)
  }, [])

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
    loadFile,
    loadUrl,
    setExcludedZones,
    setSkipExcluded,
    changePlaybackRate,
  }
}
