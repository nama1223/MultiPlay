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

/** 現在のバランスでミックスを書き出してダウンロードさせる（SectionList の全体DL用） */
export async function downloadCurrentMix(fileName: string, excludes: { start: number; end: number }[]): Promise<void> {
  const blob = await engine.renderMixdown(currentMix, excludes)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
