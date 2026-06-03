import { useEffect, useState } from 'react'
import { Download, RotateCw, X } from 'lucide-react'
import type { UpdaterStatus } from '@shared/types'

/**
 * Bottom-of-window banner shown when the auto-updater has fetched a new
 * release. The fire path: main process → `updater:available` (download
 * starts) → `updater:downloaded` (banner shows "Update" button) → user
 * clicks → `updater:install` IPC → main quits + relaunches into the new
 * installer. Dismissible — user can ignore until next restart.
 */
export default function UpdateToast(): JSX.Element | null {
  const [status, setStatus] = useState<'idle' | 'downloading' | 'ready'>('idle')
  const [info, setInfo] = useState<UpdaterStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const offAvail = window.api.onUpdateAvailable((s) => {
      setInfo(s)
      setStatus('downloading')
      setDismissed(false)
    })
    const offReady = window.api.onUpdateDownloaded((s) => {
      setInfo(s)
      setStatus('ready')
      setDismissed(false)
    })
    return () => {
      offAvail()
      offReady()
    }
  }, [])

  if (status === 'idle' || dismissed || !info) return null

  return (
    <div className="update-toast">
      <div className="update-toast-icon">
        {status === 'ready' ? <Download size={16} /> : <RotateCw size={16} />}
      </div>
      <div className="update-toast-text">
        {status === 'ready' ? (
          <>
            <strong>URterminal {info.version}</strong> is ready to install.
          </>
        ) : (
          <>
            Downloading <strong>URterminal {info.version}</strong>…
          </>
        )}
      </div>
      {status === 'ready' && (
        <button
          className="btn primary sm update-toast-btn"
          disabled={installing}
          onClick={() => {
            setInstalling(true)
            void window.api.installUpdate()
          }}
        >
          {installing ? 'Restarting…' : 'Update'}
        </button>
      )}
      <button
        className="update-toast-close"
        title="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <X size={13} />
      </button>
    </div>
  )
}
