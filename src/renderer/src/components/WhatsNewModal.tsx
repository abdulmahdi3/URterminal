import { useEffect, useState } from 'react'
import {
  Sparkles,
  Wrench,
  ArrowLeft,
  ArrowRight,
  Check,
  Rocket,
  Loader2,
  Search
} from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useSettings } from '@renderer/store/settings'
import { notesFor, type WhatsNewStep, type WhatsNewDemo } from '@renderer/lib/whatsNew'

/** Icon for a step — explicit kind wins, else the release's overall nature. */
function StepIcon({ kind }: { kind: 'feature' | 'fix' }): JSX.Element {
  return kind === 'fix' ? <Wrench size={22} /> : <Sparkles size={22} />
}

/** Fake agent output lines for the "follow live output" demo (loops seamlessly). */
const FOLLOW_LINES = [
  { t: 'Thinking…', c: 'run' },
  { t: 'Read terminalPool.ts', c: 'ok' },
  { t: 'Editing follow-tail logic', c: 'run' },
  { t: 'Applied 2 edits', c: 'ok' },
  { t: 'Running typecheck', c: 'run' },
  { t: 'No type errors', c: 'ok' },
  { t: 'Building renderer', c: 'run' },
  { t: 'Done', c: 'ok' }
]

/**
 * Small built-in animated previews (no binary assets) shown above a step when it
 * has no recorded `media`. CSS-driven so they're crisp and theme-aware.
 */
function WhatsNewDemoView({ kind }: { kind: WhatsNewDemo }): JSX.Element {
  if (kind === 'loader') {
    return (
      <div className="wn-demo wn-demo-loader">
        <Loader2 size={22} className="spin" />
        <span>
          Starting <b>Kali Linux</b>…
        </span>
      </div>
    )
  }
  if (kind === 'follow') {
    // Duplicated list + a -50% scroll gives a seamless upward stream; the prompt
    // row stays pinned at the bottom to show input doesn't drift with output.
    const lines = [...FOLLOW_LINES, ...FOLLOW_LINES]
    return (
      <div className="wn-demo wn-demo-term">
        <div className="wn-term">
          <div className="wn-term-stream">
            {lines.map((l, i) => (
              <div className="wn-line" key={i}>
                <span className={l.c === 'ok' ? 'ok' : 'run'}>{l.c === 'ok' ? '✓' : '●'}</span> {l.t}
              </div>
            ))}
          </div>
        </div>
        <div className="wn-prompt">
          <span className="wn-arrow">❯</span> <span className="wn-caret" />
        </div>
      </div>
    )
  }
  if (kind === 'budget') {
    // A status-bar budget meter filling toward 100%.
    return (
      <div className="wn-demo wn-demo-budget">
        <div className="wn-bud-row">
          <span className="wn-bud-label">session budget</span>
          <span className="wn-bud-pct">80%</span>
        </div>
        <div className="wn-bud-bar">
          <span className="wn-bud-fill" />
        </div>
        <div className="wn-bud-toast">⚠ 80% of session token budget used</div>
      </div>
    )
  }
  if (kind === 'switch') {
    // A mini quick-switcher: search line + rows with a highlight cycling through.
    return (
      <div className="wn-demo wn-demo-switch">
        <div className="wn-sw-search">
          <Search size={11} /> <span>term</span>
        </div>
        <div className="wn-sw-list">
          <div className="wn-sw-hl" />
          <div className="wn-sw-row">claude · /web</div>
          <div className="wn-sw-row">powershell · ~</div>
          <div className="wn-sw-row">kali · ssh root@box</div>
        </div>
      </div>
    )
  }
  // 'tour' — a floating rocket with pulsing sparkles
  return (
    <div className="wn-demo wn-demo-tour">
      <Sparkles size={14} className="wn-spark wn-spark-1" />
      <Rocket size={28} className="wn-rocket" />
      <Sparkles size={11} className="wn-spark wn-spark-2" />
      <Sparkles size={13} className="wn-spark wn-spark-3" />
    </div>
  )
}

/**
 * Stepped "What's new" tour. Shown once on the first launch after an update
 * (and on demand from the command palette). The shown version is held in the UI
 * store; dismissing records it as `lastSeenVersion` so it never repeats.
 */
export default function WhatsNewModal(): JSX.Element | null {
  const version = useUi((s) => s.whatsNewVersion)
  const setVersion = useUi((s) => s.setWhatsNewVersion)
  const notes = version ? notesFor(version) : undefined
  const [step, setStep] = useState(0)

  // Reset to the first step whenever a tour opens (the component stays mounted).
  useEffect(() => {
    if (version) setStep(0)
  }, [version])

  if (!version || !notes) return null

  const steps = notes.steps
  const idx = Math.min(step, steps.length - 1)
  const cur: WhatsNewStep = steps[idx]
  const curKind: 'feature' | 'fix' =
    cur.kind ?? (notes.kind === 'fix' ? 'fix' : 'feature')
  const isLast = idx >= steps.length - 1
  const isFirst = idx <= 0

  // Mark this version seen and close. Patching is fire-and-forget; the modal
  // closes immediately so the user isn't blocked on disk I/O.
  const close = (): void => {
    void useSettings.getState().patch({ prefs: { lastSeenVersion: version } })
    setVersion(null)
  }

  const headerLabel =
    notes.kind === 'fix' ? 'Fixes' : notes.kind === 'mixed' ? "What's new & fixed" : "What's new"

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal whatsnew" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header whatsnew-header">
          <div className="whatsnew-title">
            <Rocket size={16} />
            <span>
              {headerLabel} <b>·</b> URterminal {version}
            </span>
          </div>
          <button className="icon-btn" onClick={close} title="Close">
            ✕
          </button>
        </div>

        <div className="modal-body whatsnew-body">
          <div className="whatsnew-headline">{notes.headline}</div>

          <div className={`whatsnew-step whatsnew-${curKind}`} key={idx}>
            {cur.media ? (
              <img className="whatsnew-media" src={cur.media} alt="" />
            ) : cur.demo ? (
              <WhatsNewDemoView kind={cur.demo} />
            ) : null}
            <div className="whatsnew-step-row">
              <div className="whatsnew-step-icon">
                <StepIcon kind={curKind} />
              </div>
              <div className="whatsnew-step-text">
                <div className="whatsnew-step-top">
                  <span className={`whatsnew-badge whatsnew-badge-${curKind}`}>
                    {curKind === 'fix' ? 'Fixed' : 'New'}
                  </span>
                  <h3>{cur.title}</h3>
                </div>
                <p>{cur.body}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="whatsnew-footer">
          {/* Step dots — click to jump */}
          <div className="whatsnew-dots">
            {steps.map((_, i) => (
              <button
                key={i}
                className={`whatsnew-dot ${i === idx ? 'active' : ''}`}
                aria-label={`Step ${i + 1}`}
                onClick={() => setStep(i)}
              />
            ))}
          </div>

          <div className="whatsnew-actions">
            {!isFirst && (
              <button className="btn" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft size={13} /> Back
              </button>
            )}
            {isLast ? (
              <button className="btn primary" onClick={close}>
                <Check size={13} /> Done
              </button>
            ) : (
              <button className="btn primary" onClick={() => setStep((s) => s + 1)}>
                Next <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
