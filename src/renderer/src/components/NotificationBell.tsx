import { useEffect, useRef, useState } from 'react'
import { Bell, Bot, DownloadCloud, AlertCircle, Info, Trash2, CheckCheck } from 'lucide-react'
import clsx from 'clsx'
import {
  useNotifications,
  relativeTime,
  type NotifKind
} from '@renderer/store/notifications'

function KindIcon({ kind }: { kind: NotifKind }): JSX.Element {
  if (kind === 'agent') return <Bot size={14} />
  if (kind === 'update') return <DownloadCloud size={14} />
  if (kind === 'error') return <AlertCircle size={14} />
  return <Info size={14} />
}

/**
 * Status-bar bell that gathers agent-finished, update, and alert notifications
 * into one dismissable feed (fed by useNotificationFeed). Opening the panel marks
 * everything read; the badge shows the unread count.
 */
export default function NotificationBell(): JSX.Element {
  const items = useNotifications((s) => s.items)
  const unread = useNotifications((s) => s.unread)
  const markAllRead = useNotifications((s) => s.markAllRead)
  const clear = useNotifications((s) => s.clear)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Mark read once the panel is opened.
  useEffect(() => {
    if (open && unread > 0) markAllRead()
  }, [open, unread, markAllRead])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={clsx('sb-notif-wrap', open && 'open')} ref={wrapRef}>
      <button
        className="sb-item sb-icon-btn sb-notif-btn"
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={12} />
        {unread > 0 && <span className="sb-notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="sb-notif-panel" onMouseDown={(e) => e.stopPropagation()}>
          <div className="sb-notif-head">
            <span>Notifications</span>
            {items.length > 0 && (
              <button className="sb-notif-clear" onClick={clear} title="Clear all">
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>
          <div className="sb-notif-list">
            {items.length === 0 ? (
              <div className="sb-notif-empty">
                <CheckCheck size={20} />
                <span>You're all caught up</span>
              </div>
            ) : (
              items.map((n) => (
                <div className={`sb-notif-item kind-${n.kind}`} key={n.id}>
                  <span className="sb-notif-icon">
                    <KindIcon kind={n.kind} />
                  </span>
                  <span className="sb-notif-text">
                    <span className="sb-notif-title">{n.title}</span>
                    {n.body && <span className="sb-notif-body">{n.body}</span>}
                  </span>
                  <span className="sb-notif-time">{relativeTime(n.ts)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
