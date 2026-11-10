export interface TrackDef {
  id: string
  name: string
  url: string
  offsetMs?: number
  gain?: number
}

export interface LoadedTrack {
  def: TrackDef
  buffer: AudioBuffer
  gainNode: GainNode
  peaks: number[]
}

export interface MixState {
  volume: number // 0..1.5 (1 = 100%)
  mute: boolean
  solo: boolean
}

const PEAK_BUCKETS = 480

export function computePeaks(buffer: AudioBuffer, buckets = PEAK_BUCKETS): number[] {
  const peaks = new Array(buckets).fill(0)
  const ch0 = buffer.getChannelData(0)
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  const per = Math.max(1, Math.floor(ch0.length / buckets))
  for (let b = 0; b < buckets; b++) {
    let max = 0
    const start = b * per
    const end = Math.min(ch0.length, start + per)
    for (let i = start; i < end; i += 8) {
      const v = Math.max(Math.abs(ch0[i]), ch1 ? Math.abs(ch1[i]) : 0)
      if (v > max) max = v
    }
    peaks[b] = max
  }
  return peaks
}

/**
 * 多トラック同期再生エンジン。
 * 全トラックを1つの AudioContext の時計で開始し、サンプル単位の同期を保つ。
 * トラックごとの offsetMs は「そのトラックが全体の何ms後ろから鳴るか」。
 */
function makeImpulseResponse(ctx: BaseAudioContext, seconds = 1.8, decay = 2.8): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = Math.min(2, buffer.numberOfChannels)
  const rate = buffer.sampleRate
  const len = buffer.length
  const bytes = 44 + len * numCh * 2
  const ab = new ArrayBuffer(bytes)
  const v = new DataView(ab)
  const wstr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  wstr(0, 'RIFF'); v.setUint32(4, bytes - 8, true); wstr(8, 'WAVEfmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * numCh * 2, true)
  v.setUint16(32, numCh * 2, true); v.setUint16(34, 16, true)
  wstr(36, 'data'); v.setUint32(40, len * numCh * 2, true)
  const chans: Float32Array[] = []
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c))
  let off = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}

export class MultiTrackEngine {
  private ctx: AudioContext | null = null
  private bus: GainNode | null = null
  private dry: GainNode | null = null
  private wet: GainNode | null = null
  reverbAmount = 0
  private sources: AudioBufferSourceNode[] = []
  private endTimer: ReturnType<typeof setTimeout> | null = null
  tracks: LoadedTrack[] = []
  duration = 0
  playing = false
  onEnded: (() => void) | null = null
  private startedAtCtx = 0
  private startPos = 0
  private pausedPos = 0

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.bus = this.ctx.createGain()
      this.dry = this.ctx.createGain()
      const convolver = this.ctx.createConvolver()
      convolver.buffer = makeImpulseResponse(this.ctx)
      this.wet = this.ctx.createGain()
      this.wet.gain.value = 0
      this.bus.connect(this.dry)
      this.dry.connect(this.ctx.destination)
      this.bus.connect(convolver)
      convolver.connect(this.wet)
      this.wet.connect(this.ctx.destination)
    }
    return this.ctx
  }

  /** リバーブ量 0..1 をドライ/ウェット配分へ反映する */
  setReverb(amount: number) {
    this.reverbAmount = Math.max(0, Math.min(1, amount))
    if (!this.ctx || !this.dry || !this.wet) return
    const now = this.ctx.currentTime
    this.wet.gain.setTargetAtTime(this.reverbAmount * 0.9, now, 0.03)
    this.dry.gain.setTargetAtTime(1 - this.reverbAmount * 0.35, now, 0.03)
  }

  async load(defs: TrackDef[], resolveUrl: (url: string) => string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const ctx = this.ensureCtx()
    this.stopSources()
    for (const t of this.tracks) t.gainNode.disconnect()
    this.tracks = []
    let done = 0
    for (const def of defs) {
      const res = await fetch(resolveUrl(def.url))
      if (!res.ok) throw new Error(`音声の取得に失敗: ${def.name} (${res.status})`)
      const ab = await res.arrayBuffer()
      const buffer = await ctx.decodeAudioData(ab)
      const gainNode = ctx.createGain()
      gainNode.gain.value = def.gain ?? 1
      gainNode.connect(this.bus!)
      this.tracks.push({ def, buffer, gainNode, peaks: computePeaks(buffer) })
      done++
      onProgress?.(done, defs.length)
    }
    this.duration = this.tracks.length
      ? Math.max(...this.tracks.map(t => t.buffer.duration + (t.def.offsetMs ?? 0) / 1000))
      : 0
    this.pausedPos = 0
    this.playing = false
  }

  private stopSources() {
    for (const s of this.sources) {
      try { s.onended = null; s.stop() } catch { /* already stopped */ }
      try { s.disconnect() } catch { /* noop */ }
    }
    this.sources = []
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null }
  }

  position(): number {
    if (!this.ctx) return this.pausedPos
    if (!this.playing) return this.pausedPos
    return Math.min(this.duration, this.startPos + (this.ctx.currentTime - this.startedAtCtx))
  }

  play(fromSec?: number) {
    const ctx = this.ensureCtx()
    if (ctx.state === 'suspended') void ctx.resume()
    const pos = fromSec ?? this.position()
    this.stopSources()
    const when = ctx.currentTime + 0.08
    for (const t of this.tracks) {
      const offsetSec = (t.def.offsetMs ?? 0) / 1000
      const src = ctx.createBufferSource()
      src.buffer = t.buffer
      src.connect(t.gainNode)
      if (pos >= offsetSec + t.buffer.duration) continue
      if (pos >= offsetSec) src.start(when, pos - offsetSec)
      else src.start(when + (offsetSec - pos))
      this.sources.push(src)
    }
    this.startedAtCtx = when
    this.startPos = pos
    this.pausedPos = pos
    this.playing = true
    const remain = this.duration - pos
    if (remain > 0) {
      this.endTimer = setTimeout(() => {
        this.playing = false
        this.pausedPos = this.duration
        this.onEnded?.()
      }, remain * 1000 + 120)
    }
  }

  pause() {
    if (!this.playing) return
    this.pausedPos = this.position()
    this.stopSources()
    this.playing = false
  }

  seek(sec: number) {
    const clamped = Math.max(0, Math.min(this.duration, sec))
    if (this.playing) this.play(clamped)
    else this.pausedPos = clamped
  }

  toggle(): boolean {
    if (this.playing) { this.pause(); return false }
    if (this.position() >= this.duration) this.play(0)
    else this.play()
    return true
  }

  /** ミキサー状態から1トラックの実効ゲインを求める（再生・書き出し共通） */
  effectiveGain(trackId: string, mix: Record<string, MixState>): number {
    const t = this.tracks.find(x => x.def.id === trackId)
    if (!t) return 0
    const anySolo = this.tracks.some(x => mix[x.def.id]?.solo)
    const m = mix[trackId] ?? { volume: 1, mute: false, solo: false }
    let g = m.volume * (t.def.gain ?? 1)
    if (m.mute) g = 0
    if (anySolo && !m.solo) g = 0
    return g
  }

  /** ミキサー状態を GainNode 群へ反映する */
  applyMix(mix: Record<string, MixState>) {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const t of this.tracks) {
      t.gainNode.gain.setTargetAtTime(this.effectiveGain(t.def.id, mix), now, 0.03)
    }
  }

  /** 現在のバランス・オフセット・リバーブでオフライン書き出しして WAV を返す */
  async renderMixdown(mix: Record<string, MixState>): Promise<Blob> {
    const rate = 44100
    const length = Math.ceil(this.duration * rate) + Math.floor(rate * 0.2)
    const off = new OfflineAudioContext(2, length, rate)
    const bus = off.createGain()
    const dry = off.createGain()
    dry.gain.value = 1 - this.reverbAmount * 0.35
    bus.connect(dry)
    dry.connect(off.destination)
    if (this.reverbAmount > 0) {
      const convolver = off.createConvolver()
      convolver.buffer = makeImpulseResponse(off)
      const wet = off.createGain()
      wet.gain.value = this.reverbAmount * 0.9
      bus.connect(convolver)
      convolver.connect(wet)
      wet.connect(off.destination)
    }
    for (const t of this.tracks) {
      const g = this.effectiveGain(t.def.id, mix)
      if (g <= 0) continue
      const src = off.createBufferSource()
      src.buffer = t.buffer
      const gn = off.createGain()
      gn.gain.value = g
      src.connect(gn)
      gn.connect(bus)
      src.start((t.def.offsetMs ?? 0) / 1000)
    }
    const rendered = await off.startRendering()
    return encodeWav(rendered)
  }

  dispose() {
    this.stopSources()
    if (this.ctx) void this.ctx.close()
    this.ctx = null
    this.tracks = []
  }
}
