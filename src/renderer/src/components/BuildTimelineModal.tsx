import { useMemo } from 'react'
import { Activity, X, Bot, Terminal as TerminalIcon, User } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { useActivity } from '@renderer/store/activity'
import { LOOP_PHASES, currentPhaseIndex, type LoopSnapshot } from '@renderer/lib/buildLoop'

const time = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * Build timeline — the daily rhythm of vibe coding made visible. A live stepper
 * (Set the vibe → Open the room → Run the crew → Review) driven by what's
 * actually open + running, plus the session's event feed. Keeps the moving parts
 * visible enough that you can steer them.
 */
export default function BuildTimelineModal(): JSX.Element | null {
  const show = useUi((s) => s.showTimeline)
  const setShow = useUi((s) => s.setShowTimeline)
  const panes = useWorkspace((s) => s.panes)
  const entries = useActivity((s) => s.entries)

  const { snap, phaseIdx, agents, recent } = useMemo(() => {
    const list = Object.values(panes)
    const agents = list.filter((p) => p.type === 'ai' || p.type === 'stream').length
    const answerCount = entries.filter((e) => e.role === 'answer').length
    const snap: LoopSnapshot = {
      paneCount: list.length,
      agentPaneCount: agents,
      activityCount: entries.length,
      answerCount
    }
    return { snap, phaseIdx: currentPhaseIndex(snap), agents, recent: entries.slice(-18).reverse() }
  }, [panes, entries])

  if (!show) return null
  const close = (): void => setShow(false)
  const last = entries.length ? entries[entries.length - 1].ts : 0

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal timeline" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="tl-title">
            <Activity size={16} />
            <span>Build timeline</span>
          </div>
          <button className="icon-btn" onClick={close} title="Close">
            <X size={14} />
          </button>
        </div>

        <div className="tl-loop">
          {LOOP_PHASES.map((p, i) => (
            <div
              key={p.id}
              className={`tl-phase ${i < phaseIdx ? 'done' : ''} ${i === phaseIdx ? 'active' : ''}`}
            >
              <span className="tl-dot" />
              <div className="tl-phase-name">{p.name}</div>
              <div className="tl-phase-hint">{p.hint}</div>
              {i < LOOP_PHASES.length - 1 && <span className="tl-arrow">→</span>}
            </div>
          ))}
        </div>

        <div className="tl-vibe">
          <span>
            <b>{snap.paneCount}</b> pane{snap.paneCount === 1 ? '' : 's'}
          </span>
          <span>
            <b>{agents}</b> agent{agents === 1 ? '' : 's'} in the room
          </span>
          <span>
            <b>{snap.activityCount}</b> events
          </span>
          {last > 0 && <span className="tl-last">last · {time(last)}</span>}
        </div>

        <div className="tl-feed">
          {recent.length === 0 && <div className="bridge-hint">No activity yet — send a prompt to start the loop.</div>}
          {recent.map((e) => (
            <div key={e.id} className={`tl-event ${e.role}`}>
              <span className="tl-event-time">{time(e.ts)}</span>
              <span className="tl-event-icon">{e.role === 'prompt' ? <User size={11} /> : <Bot size={11} />}</span>
              <span className="tl-event-pane">{e.paneTitle}</span>
              <span className="tl-event-text">{e.text.replace(/\s+/g, ' ').slice(0, 90)}</span>
            </div>
          ))}
        </div>

        <div className="tl-foot">
          <TerminalIcon size={12} /> The human stays in the room — jump between code, output and state while
          you decide what ships.
        </div>
      </div>
    </div>
  )
}
