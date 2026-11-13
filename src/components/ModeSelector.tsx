import { AppMode } from '../types'

interface Props {
  mode: AppMode
  onChange: (mode: AppMode) => void
  /** 「編集」を出すか（マーカー編集は全員可なので通常は常に true） */
  showEdit?: boolean
}

export function ModeSelector({ mode, onChange, showEdit = true }: Props) {
  const modes = (['play', 'edit', 'settings'] as AppMode[]).filter(m => m !== 'edit' || showEdit)
  return (
    <div className="mode-selector">
      {modes.map((m) => (
        <button
          key={m}
          className={`mode-btn ${mode === m ? 'active' : ''}`}
          onClick={() => onChange(m)}
        >
          {m === 'play' ? '▶ 再生' : m === 'edit' ? '✏️ 編集' : '⚙️ 設定'}
        </button>
      ))}
    </div>
  )
}
