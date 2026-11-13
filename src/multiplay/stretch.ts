import { SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs'

/**
 * ピッチを変えずに再生速度を変えるためのオフライン時間伸縮（SoundTouch）。
 *
 * tempo は再生速度そのもの（0.75 = 75% の速さ → 尺は 1/0.75 倍に伸びる）。
 * SoundTouch は末尾のドレインで出力が少し短くなり内容の最後が欠けるため、
 * 入力末尾に尺の 3% 程度の無音を足してから伸縮し、出力を
 * round(入力 frames / tempo) に切り詰める。これで内容欠落なしに
 * 尺がサンプル単位で正確になる（実測で検証済み: testwork/stretch-spike）。
 */

/** 末尾に足す無音の割合（入力尺に対して） */
const PAD_RATIO = 0.03
const CHUNK_FRAMES = 4096

/** 入力バッファの末尾に無音を足したコピーを作る */
function padTail(ctx: BaseAudioContext, buffer: AudioBuffer, padFrames: number): AudioBuffer {
  const channels = Math.max(1, buffer.numberOfChannels)
  const padded = ctx.createBuffer(channels, buffer.length + padFrames, buffer.sampleRate)
  for (let ch = 0; ch < channels; ch++) {
    padded.getChannelData(ch).set(buffer.getChannelData(ch))
  }
  return padded
}

/**
 * buffer を tempo で時間伸縮した新しい AudioBuffer を返す。
 * tempo === 1 のときは元のバッファをそのまま返す。
 * 出力は常にステレオ（SoundTouch がステレオ処理のため。モノラルは両ch同内容）。
 */
export function stretchBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, tempo: number): AudioBuffer {
  if (Math.abs(tempo - 1) < 1e-9) return buffer
  const targetFrames = Math.round(buffer.length / tempo)
  const padFrames = Math.ceil(buffer.length * PAD_RATIO)
  const sourceBuffer = padFrames > 0 ? padTail(ctx, buffer, padFrames) : buffer

  const st = new SoundTouch()
  st.tempo = tempo
  const filter = new SimpleFilter(new WebAudioBufferSource(sourceBuffer), st)

  const chunk = new Float32Array(CHUNK_FRAMES * 2)
  const parts: Float32Array[] = []
  let totalFrames = 0
  for (;;) {
    const got = filter.extract(chunk, CHUNK_FRAMES)
    if (got === 0) break
    // 目標尺を超えた分は溜めない（切り詰め前提なので捨ててよい）
    const keep = Math.min(got, Math.max(0, targetFrames - totalFrames))
    if (keep > 0) parts.push(chunk.slice(0, keep * 2))
    totalFrames += got
    if (totalFrames >= targetFrames) break
  }

  const outFrames = Math.min(targetFrames, parts.reduce((s, p) => s + p.length / 2, 0))
  const out = ctx.createBuffer(2, Math.max(1, outFrames), buffer.sampleRate)
  const left = out.getChannelData(0)
  const right = out.getChannelData(1)
  let off = 0
  for (const p of parts) {
    const frames = p.length / 2
    for (let i = 0; i < frames; i++) {
      left[off + i] = p[i * 2]
      right[off + i] = p[i * 2 + 1]
    }
    off += frames
  }
  return out
}
