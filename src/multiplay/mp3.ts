import { Mp3Encoder } from 'lamejs'
// lamejs 1.2.1 のモジュール版は、連結版（lame.all.js）の共有スコープ前提で
// 一部の識別子をグローバル参照する作りになっており、そのままだと
// 「MPEGMode is not defined」でエンコーダが落ちる（Node でも再現する不具合）。
// 不足する3つはサブモジュールが export する本物なので、同一の実体を
// グローバルへ差して連結版と同じ環境を再現する。
import MPEGMode from 'lamejs/src/js/MPEGMode.js'
import Lame from 'lamejs/src/js/Lame.js'
import BitStream from 'lamejs/src/js/BitStream.js'

const g = globalThis as unknown as Record<string, unknown>
if (g.MPEGMode === undefined) g.MPEGMode = MPEGMode
if (g.Lame === undefined) g.Lame = Lame
if (g.BitStream === undefined) g.BitStream = BitStream

/** Float32 のサンプル列を lamejs 用の Int16 へ変換する */
function floatToInt16(data: Float32Array): Int16Array {
  const out = new Int16Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/**
 * AudioBuffer を MP3（ステレオ・CBR）に変換する。純JS（lamejs）なので
 * 端末側だけで完結する。ビットレートは目安 160kbps。
 */
export function encodeMp3(buffer: AudioBuffer, bitRateKbps = 160): Blob {
  const left = floatToInt16(buffer.getChannelData(0))
  const right = buffer.numberOfChannels > 1 ? floatToInt16(buffer.getChannelData(1)) : left
  const encoder = new Mp3Encoder(2, buffer.sampleRate, bitRateKbps)
  const parts: Uint8Array[] = []
  const BLOCK = 1152 // MP3 の1フレーム分のサンプル数
  for (let i = 0; i < left.length; i += BLOCK) {
    const data = encoder.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK))
    if (data.length > 0) parts.push(new Uint8Array(data))
  }
  const tail = encoder.flush()
  if (tail.length > 0) parts.push(new Uint8Array(tail))
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' })
}
