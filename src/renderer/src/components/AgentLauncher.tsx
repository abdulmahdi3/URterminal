import { useState } from 'react'
import { FolderOpen, Sparkles, ArrowRight } from 'lucide-react'

interface Props {
  command: string
  defaultCwd: string
  onOpen: (cwd: string) => void
}

/**
 * Small form shown before an agent launches: pick the folder to open the agent
 * in (and trust). Prefilled with the last-used folder for one-click reopen.
 */
export default function AgentLauncher({ command, defaultCwd, onOpen }: Props): JSX.Element {
  const [path, setPath] = useState(defaultCwd)

  // Browsing to a folder is itself the confirmation — open claude immediately.
  const browse = async (): Promise<void> => {
    const picked = await window.api.pickDirectory(path || undefined)
    if (picked) {
      setPath(picked)
      onOpen(picked)
    }
  }

  // The button is for the typed path / reusing the last folder.
  const open = (): void => {
    const v = path.trim()
    if (v) onOpen(v)
  }

  return (
    <div className="agent-launcher">
      <div className="launcher-card">
        <div className="launcher-head">
          <Sparkles size={16} className="launcher-spark" />
          <span>
            Open <b>{command}</b> in a folder
          </span>
        </div>
        <p className="launcher-hint">
          {command} will start in this folder and ask to trust it on first run.
        </p>
        <div className="launcher-row">
          <input
            className="input"
            autoFocus
            value={path}
            placeholder="C:\path\to\project"
            spellCheck={false}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && open()}
          />
          <button className="btn" title="Browse…" onClick={browse}>
            <FolderOpen size={14} /> Browse
          </button>
        </div>
        <div className="launcher-actions">
          <button className="btn primary" onClick={open} disabled={!path.trim()}>
            Open {command} <ArrowRight size={14} />
          </button>
          {defaultCwd && (
            <span className="launcher-last">
              <kbd>↵</kbd> reuse last folder
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
