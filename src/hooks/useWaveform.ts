import { useState, useEffect } from 'react'
import { engine } from '../multiplay/bridge'

/**
 * MultiPlay では波形はエンジンが読み込んだ全トラックの重ね合わせから作る。
 * 元の useWaveform と同じ戻り値の形を保つ（peakLevel はノーマライズ用で常に null）。
 */
export function useWaveform(
  src: string | null,
  duration: number,
  _fileKey: string | null,
) {
  const [samples, setSamples] = useState<Float32Array | null>(null)
  const [peakLevel, setPeakLevel] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasStored, setHasStored] = useState(false)

  useEffect(() => {
    setSamples(null)
    setPeakLevel(null)
    setHasStored(false)
    if (!src || duration <= 0) return
    setLoading(true)
    // エンジンの読み込み完了後に duration が立つので、この時点でピークが揃っている
    const peaks = engine.mixPeaks(1200)
    setSamples(peaks)
    setHasStored(true)
    setLoading(false)
  }, [src, duration])

  return { samples, setSamples, peakLevel, setPeakLevel, loading, hasStored }
}
