import { useEffect, useState } from 'react'
import { Download, RotateCw, Loader2, X } from 'lucide-react'
import { useUpdater } from '@renderer/store/updater'

/**
 * Bottom-of-window banner for a background-detected update (the startup check,
 * fired when the Settings panel isn't open). Reads the shared updater store, so
 * it stays in lock-step with the Settings "Version" control: download progress →
 * "Relaunch to update" → a brief "Updating…" state as the app quits to apply the
 * silent install. Dismissible; re-appears if a newer phase arrives.
 */
export default function UpdateToast(): JSX.Element | null {
  const phase = useUpdater((s) => s.phase)
  const version = useUpdater((s) => s.version)
  const percent = useUpdater((s) => s.percent)
  const install = useUpdater((s) => s.install)
  const [dismissed, setDismissed] = useState(false)

  // Any move into a fresh download/ready brings the banner back.
  useEffect(() => {
    if (phase === 'downloading' || phase === 'ready') setDismissed(false)
  }, [phase])

  const visible = phase === 'downloading' || phase === 'ready' || phase === 'installing'
  if (!visible || dismissed) return null

  return (
    <div className="update-toast">
      <div className="update-toast-icon">
        {phase === 'ready' ? (
          <Download size={16} />
        ) : phase === 'installing' ? (
          <Loader2 size={16} className="spin" />
        ) : (
          <RotateCw size={16} className="spin" />
        )}
      </div>
      <div className="update-toast-text">
        {phase === 'ready' ? (
          <>
            <strong>URterminal {version}</strong> is ready to install.
          </>
        ) : phase === 'installing' ? (
          <>Updating — the app will restart…</>
        ) : (
          <>
            Downloading <strong>URterminal {version}</strong>… {percent}%
            <div className="update-toast-bar">
              <div className="update-toast-bar-fill" style={{ width: `${percent}%` }} />
            </div>
          </>
        )}
      </div>
      {phase === 'ready' && (
        <button className="btn primary sm update-toast-btn" onClick={() => install()}>
          Relaunch to update
        </button>
      )}
      {phase !== 'installing' && (
        <button className="update-toast-close" title="Dismiss" onClick={() => setDismissed(true)}>
          <X size={13} />
        </button>
      )}
    </div>
  )
}
