import { useState } from 'react'
import { audioCacheUsage, clearAudioCache, AUDIO_CACHE_CAP_BYTES } from '../multiplay/audioCache'

/** 設定画面に出す、音声キャッシュの使用量表示と消去ボタン */
export function AudioCachePanel() {
  const [usage, setUsage] = useState(() => audioCacheUsage())
  const [arm, setArm] = useState(false)
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(0)}MB`

  const clear = async () => {
    if (!arm) { setArm(true); return }
    await clearAudioCache()
    setUsage(audioCacheUsage())
    setArm(false)
  }

  return (
    <div className="cache-panel">
      <div className="cache-panel-title">音声キャッシュ（この端末）</div>
      <p className="cache-panel-text">
        聴いた曲の音声を端末に保存して、次回から速く開けるようにしています。
        現在 {usage.count} ファイル / {mb(usage.bytes)}（上限 {mb(AUDIO_CACHE_CAP_BYTES)}）。
        上限を超えると、最後に聴いたのが古いものから自動で消えます。
      </p>
      <div className="mp-admin-row">
        <button className="mp-btn danger" onClick={clear}>
          {arm ? '本当にキャッシュを全部消しますか？（もう一度押すと実行）' : 'キャッシュを消す'}
        </button>
        {arm && <button className="mp-btn sub" onClick={() => setArm(false)}>やめる</button>}
      </div>
    </div>
  )
}
