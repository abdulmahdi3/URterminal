import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { AlertTriangle } from 'lucide-react'
import { useConfirm } from '@renderer/store/confirm'

/**
 * The themed confirmation dialog (one instance, mounted at the app root).
 * Replaces window.confirm so destructive actions get an in-app, on-brand
 * prompt instead of the OS default. Enter confirms, Esc / overlay cancels.
 */
export default function ConfirmDialog(): JSX.Element | null {
  const open = useConfirm((s) => s.open)
  const options = useConfirm((s) => s.options)
  const respond = useConfirm((s) => s.respond)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        respond(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        respond(true)
      }
    }
    // Capture so we beat terminal / global shortcut handlers while open.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, respond])

  if (!open || !options) return null
  const danger = options.tone === 'danger'

  return (
    <div className="modal-overlay confirm-overlay" onMouseDown={() => respond(false)}>
      <div className="modal confirm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="confirm-body">
          <span className={clsx('confirm-icon', danger && 'danger')}>
            <AlertTriangle size={20} />
          </span>
          <div className="confirm-text">
            <h3 className="confirm-title">{options.title}</h3>
            <p className="confirm-message">{options.message}</p>
          </div>
        </div>
        <div className="confirm-actions">
          <button className="btn" onClick={() => respond(false)}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            className={clsx('btn', danger ? 'danger' : 'primary')}
            onClick={() => respond(true)}
          >
            {options.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
