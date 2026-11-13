declare module 'soundtouchjs' {
  /** SoundTouch 本体。tempo: 出力尺 = 入力尺 / tempo（tempo < 1 で長く・遅く） */
  export class SoundTouch {
    tempo: number
    rate: number
    pitch: number
  }

  /** AudioBuffer をインターリーブ済みステレオのサンプル供給源にする */
  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer)
  }

  /** 供給源 → パイプ（SoundTouch）の抽出フィルタ */
  export class SimpleFilter {
    constructor(source: WebAudioBufferSource, pipe: SoundTouch)
    extract(output: Float32Array, numFrames: number): number
  }
}
