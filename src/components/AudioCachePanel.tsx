import { useState } from 'react'
import { audioCacheUsage, clearAudioCache, getAudioCacheCapMb, setAudioCacheCapMb } from '../multiplay/audioCache'

/** 設定画面の最下段に出す、音声キャッシュの使用量・容量設定・消去 */
export function AudioCachePanel() {
  const [usage, setUsage] = useState(() => audioCacheUsage())
  const [arm, setArm] = useState(false)
  const [capInput, setCapInput] = useState(() => String(getAudioCacheCapMb()))
  const [capNote, setCapNote] = useState('')
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(0)}MB`

  const clear = async () => {
    if (!arm) { setArm(true); return }
    await clearAudioCache()
    setUsage(audioCacheUsage())
    setArm(false)
  }

  const applyCap = async () => {
    const v = Number(capInput)
    if (!Number.isFinite(v) || v <= 0) {
      setCapNote('容量は 1 以上の数値（MB）で入力してください')
      return
    }
    await setAudioCacheCapMb(v)
    setCapInput(String(getAudioCacheCapMb()))
    setUsage(audioCacheUsage())
    setCapNote(`上限を ${getAudioCacheCapMb()}MB にしました`)
  }

  return (
    <div className="cache-panel">
      <div className="cache-panel-title">音声キャッシュ（この端末）</div>
      <p className="cache-panel-text">
        聴いた曲の音声を端末に保存して、次回から速く開けるようにしています。
        現在 {usage.count} ファイル / {mb(usage.bytes)}（上限 {getAudioCacheCapMb()}MB）。
        上限を超えると、最後に聴いたのが古いものから自動で消えます。
      </p>
      <div className="cache-cap-row">
        <label className="cache-cap-label" htmlFor="mp-cache-cap">容量の上限</label>
        <input
          id="mp-cache-cap"
          className="cache-cap-input"
          type="number"
          min={1}
          step={100}
          inputMode="numeric"
          value={capInput}
          onChange={(e) => { setCapInput(e.target.value); setCapNote('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') void applyCap() }}
        />
        <span className="cache-cap-unit">MB</span>
        <button className="mp-btn" onClick={() => void applyCap()}>変更する</button>
      </div>
      {capNote && <p className="cache-panel-text">{capNote}</p>}
      <div className="mp-admin-row">
        <button className="mp-btn danger" onClick={clear}>
          {arm ? '本当にキャッシュを全部消しますか？（もう一度押すと実行）' : 'キャッシュを消す'}
        </button>
        {arm && <button className="mp-btn sub" onClick={() => setArm(false)}>やめる</button>}
      </div>
    </div>
  )
}
