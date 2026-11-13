import { MultiTrackEngine } from '../audio-engine'
import type { MpSongManifest } from './types'

/** プレイヤーフック・波形フック・ミキサーで共有するエンジンと現在の曲 */
export const engine = new MultiTrackEngine()

let currentManifest: MpSongManifest | null = null
export function setCurrentManifest(m: MpSongManifest | null) { currentManifest = m }
export function getCurrentManifest(): MpSongManifest | null { return currentManifest }

import type { MixState } from '../audio-engine'

let currentMix: Record<string, MixState> = {}
export function setCurrentMix(mix: Record<string, MixState>) { currentMix = mix }
export function getCurrentMix(): Record<string, MixState> { return currentMix }

/** 現在のバランスで全体のミックスを書き出してダウンロードさせる（マーカーリストの全体DL用） */
export async function downloadCurrentMix(fileName: string): Promise<void> {
  const blob = await engine.renderMixdown(currentMix)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
