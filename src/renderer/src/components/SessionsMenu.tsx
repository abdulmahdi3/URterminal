import { useEffect, useRef, useState } from 'react'
import { History, Save, RotateCcw, Trash2, MessageSquare, Layers } from 'lucide-react'
import clsx from 'clsx'
import type { ChatSession } from '@shared/types'
import { useSessions } from '@renderer/store/sessions'
import { toast } from '@renderer/store/toasts'

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Last path segment of a folder, for the chat row's secondary line. */
function folderName(cwd?: string): string {
  if (!cwd) return ''
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

/** Title-bar dropdown: save/restore whole workspaces, and reopen individual chats. */
export default function SessionsMenu(): JSX.Element {
  const sessions = useSessions((s) => s.sessions)
  const chats = useSessions((s) => s.chats)
  const save = useSessions((s) => s.save)
  const restore = useSessions((s) => s.restore)
  const remove = useSessions((s) => s.remove)
  const resumeChat = useSessions((s) => s.resumeChat)
  const removeChat = useSessions((s) => s.removeChat)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const doSave = (): void => {
    const name = draft.trim() || `Session ${new Date().toLocaleString()}`
    save(name)
    setDraft('')
    toast(`Session saved: ${name}`, 'ok')
  }

  const doRestore = (id: string): void => {
    void restore(id).then((s) => {
      if (s) {
        toast(`Restored session: ${s.name}`, 'ok')
        setOpen(false)
      }
    })
  }

  const doResumeChat = (chat: ChatSession): void => {
    resumeChat(chat)
    toast(`Resuming: ${chat.title}`, 'ok')
    setOpen(false)
  }

  return (
    <div className="sessions-wrap" ref={wrapRef} data-nodrag>
      <button
        className={clsx('icon-btn sessions-btn', open && 'active')}
        title="Saved sessions & chats"
        onClick={() => setOpen((v) => !v)}
      >
        <History size={13} />
      </button>

      {open && (
        <div className="sessions-menu">
          <div className="sessions-save">
            <input
              className="sessions-input"
              placeholder="Name this session…"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSave()
                if (e.key === 'Escape') setOpen(false)
              }}
            />
            <button className="btn sm primary" onClick={doSave} title="Save current workspace">
              <Save size={12} /> Save
            </button>
          </div>

          <div className="sessions-list">
            <div className="sessions-section">
              <Layers size={11} /> Workspaces
            </div>
            {sessions.length === 0 ? (
              <p className="sessions-empty">No saved workspaces yet.</p>
            ) : (
              [...sessions]
                .sort((a, b) => b.savedAt - a.savedAt)
                .map((s) => (
                  <div key={s.id} className={clsx('session-row', s.auto && 'auto')}>
                    <div className="session-info" onClick={() => doRestore(s.id)} title="Restore">
                      <span className="session-name">{s.name}</span>
                      <span className="session-meta">
                        {s.paneCount} pane{s.paneCount !== 1 ? 's' : ''} · {relativeTime(s.savedAt)}
                      </span>
                    </div>
                    <button
                      className="icon-btn"
                      title="Restore this workspace"
                      onClick={() => doRestore(s.id)}
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Delete saved workspace"
                      onClick={() => remove(s.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
            )}

            <div className="sessions-section">
              <MessageSquare size={11} /> Chats
            </div>
            {chats.length === 0 ? (
              <p className="sessions-empty">No chats yet — start one in a Claude pane.</p>
            ) : (
              chats.map((c) => (
                <div key={c.sessionId} className="session-row">
                  <div
                    className="session-info"
                    onClick={() => doResumeChat(c)}
                    title="Reopen this chat in a new pane"
                  >
                    <span className="session-name">{c.title}</span>
                    <span className="session-meta">
                      {folderName(c.cwd) ? `${folderName(c.cwd)} · ` : ''}
                      {relativeTime(c.updatedAt)}
                    </span>
                  </div>
                  <button
                    className="icon-btn"
                    title="Reopen this chat in a new pane"
                    onClick={() => doResumeChat(c)}
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Remove from this list (keeps the conversation on disk)"
                    onClick={() => removeChat(c.sessionId)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
