import { useEffect, useState } from 'react'
import { engine, loadReverb, storeReverb } from '../multiplay/bridge'

/**
 * リバーブ量の調整行（トラック音量ミキサーの真上に置く）。
 * エンジンには元からリバーブ（Convolver）があり、ここはその入口。
 * 値は端末に保存し（mp_reverb_v1）、曲を開いた時に復元する。書き出しには効かせない。
 */
export function ReverbControl() {
  const [pct, setPct] = useState(() => Math.round(loadReverb() * 100))

  // 開いた時点の保存値をエンジンへ反映する
  // （曲の読込完了時にも App 側で再適用されるので、初期化順に左右されない）
  useEffect(() => { engine.setReverb(loadReverb()) }, [])

  const onChange = (v: number) => {
    setPct(v)
    engine.setReverb(v / 100)
    storeReverb(v / 100)
  }

  return (
    <div className="reverb-control">
      <span className="reverb-label">リバーブ</span>
      <input
        type="range" min={0} max={100} step={1} value={pct}
        onChange={e => onChange(Number(e.target.value))}
        className="reverb-slider" aria-label="リバーブ量"
      />
      <span className="reverb-val">{pct}%</span>
    </div>
  )
}
