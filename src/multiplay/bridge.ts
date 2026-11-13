import { MultiTrackEngine, encodeWav } from '../audio-engine'
import { encodeMp3 } from './mp3'
import { FIXTURES } from '../config'
import type { MpSongManifest } from './types'

/** プレイヤーフック・波形フック・ミキサーで共有するエンジンと現在の曲 */
export const engine = new MultiTrackEngine()

// フィクスチャビルドでのみ、検証用にエンジンを露出する（本番ビルドでは無効）
if (FIXTURES) {
  ;(window as unknown as { __mpEngine?: MultiTrackEngine }).__mpEngine = engine
  ;(window as unknown as { __mpEncodeMp3?: typeof encodeMp3 }).__mpEncodeMp3 = encodeMp3
}

let currentManifest: MpSongManifest | null = null
export function setCurrentManifest(m: MpSongManifest | null) { currentManifest = m }
export function getCurrentManifest(): MpSongManifest | null { return currentManifest }

import type { MixState } from '../audio-engine'

let currentMix: Record<string, MixState> = {}
export function setCurrentMix(mix: Record<string, MixState>) { currentMix = mix }
export function getCurrentMix(): Record<string, MixState> { return currentMix }

/**
 * 個人ミックス（トラック音量・ミュート・ソロ）の曲別保存。
 * マニフェストの gain（管理者が決める曲全体のバランス）とは別概念で、
 * サーバーには上げず、この端末の localStorage にだけ残す。
 * 実効ゲインは従来通り「マニフェスト gain × 個人音量」（エンジン側で合成）。
 * モード切替で TrackMixer がアンマウントされても失われないよう、
 * 実体はここ（モジュールスコープ＋localStorage）に置く。
 */
const MIX_LS_PREFIX = 'mp_mix_v1:'
const personalMixBySong = new Map<string, Record<string, MixState>>()

function sanitizeMix(raw: unknown): Record<string, MixState> {
  const out: Record<string, MixState> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const m = v as Partial<MixState> | null
    if (!m || typeof m !== 'object') continue
    const volume = typeof m.volume === 'number' && Number.isFinite(m.volume)
      ? Math.max(0, Math.min(1.5, m.volume))
      : 1
    out[id] = { volume, mute: !!m.mute, solo: !!m.solo }
  }
  return out
}

export function loadPersonalMix(songId: string): Record<string, MixState> {
  const mem = personalMixBySong.get(songId)
  if (mem) return mem
  let loaded: Record<string, MixState> = {}
  try {
    const raw = localStorage.getItem(MIX_LS_PREFIX + songId)
    if (raw) loaded = sanitizeMix(JSON.parse(raw))
  } catch { /* 読めなければ初期バランス */ }
  personalMixBySong.set(songId, loaded)
  return loaded
}

export function storePersonalMix(songId: string, mix: Record<string, MixState>): void {
  personalMixBySong.set(songId, mix)
  try { localStorage.setItem(MIX_LS_PREFIX + songId, JSON.stringify(mix)) } catch { /* 保存できなくても動作は続ける */ }
}

/**
 * リバーブ量（0..1）の端末保存。曲のデータではなく個人の再生環境設定なので、
 * マニフェストには入れず localStorage だけに残す（キー mp_reverb_v1）。
 */
const REVERB_LS_KEY = 'mp_reverb_v1'
export function loadReverb(): number {
  try {
    const v = Number(localStorage.getItem(REVERB_LS_KEY))
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
  } catch { return 0 }
}
export function storeReverb(v: number): void {
  try { localStorage.setItem(REVERB_LS_KEY, String(Math.max(0, Math.min(1, v)))) } catch { /* 保存できなくても動作は続ける */ }
}

/** ダウンロード形式（MP3/WAV）の端末保存。既定は MP3 */
export type DownloadFormat = 'mp3' | 'wav'
const DL_FORMAT_LS_KEY = 'mp_download_format_v1'
export function loadDownloadFormat(): DownloadFormat {
  try { return localStorage.getItem(DL_FORMAT_LS_KEY) === 'wav' ? 'wav' : 'mp3' } catch { return 'mp3' }
}
export function storeDownloadFormat(f: DownloadFormat): void {
  try { localStorage.setItem(DL_FORMAT_LS_KEY, f) } catch { /* 保存できなくても動作は続ける */ }
}

/** 現在のバランスでミックスを書き出す。書き出しは現行仕様どおりドライ（リバーブ0）にする */
async function renderDryMix(range?: { start: number; end: number }): Promise<AudioBuffer> {
  // renderMixdownBuffer はエンジンの reverbAmount を参照して配分を決めるので、
  // 書き出しの間だけ 0 に退避する。再生側の wet/dry ゲインには触らない。
  const prevReverb = engine.reverbAmount
  engine.reverbAmount = 0
  try {
    return await engine.renderMixdownBuffer(currentMix, range)
  } finally {
    engine.reverbAmount = prevReverb
  }
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  // DOM に繋いでからクリックする（外れたままのアンカーだと download 属性の
  // ファイル名がブラウザに伝わらないことがあるため）
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** 現在のバランスで全体のミックスを書き出してダウンロードさせる（マーカーリストの全体DL用） */
export async function downloadCurrentMix(fileBase: string, format: DownloadFormat): Promise<void> {
  const buffer = await renderDryMix()
  const blob = format === 'mp3' ? encodeMp3(buffer) : encodeWav(buffer)
  saveBlob(blob, `${fileBase}.${format}`)
}

/** 選択中の範囲だけを現在のバランスで切り取って MP3 でダウンロードさせる（範囲DL用） */
export async function downloadRangeMix(fileBase: string, start: number, end: number): Promise<void> {
  const buffer = await renderDryMix({ start, end })
  saveBlob(encodeMp3(buffer), `${fileBase}.mp3`)
}
