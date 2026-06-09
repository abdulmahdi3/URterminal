import { useEffect, useMemo, useState } from 'react'
import {
  Sparkles,
  Wrench,
  ArrowLeft,
  ArrowRight,
  Check,
  Rocket,
  Loader2,
  Search,
  GitBranch,
  FileText,
  Download
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
  if (kind === 'drop') {
    // A file chip dropping into a mini terminal prompt.
    return (
      <div className="wn-demo wn-demo-drop">
        <div className="wn-drop-file">
          <FileText size={13} /> report.pdf
        </div>
        <div className="wn-drop-term">
          <span className="wn-arrow">❯</span> ./build.sh <span className="wn-drop-path">"C:\My Files\report.pdf"</span>
          <span className="wn-caret" />
        </div>
      </div>
    )
  }
  if (kind === 'git') {
    // A mock status-bar git chip.
    return (
      <div className="wn-demo wn-demo-git">
        <div className="wn-git-chip">
          <GitBranch size={13} />
          <span>main</span>
          <span className="wn-git-dirty">●3</span>
          <span className="wn-git-ab">↑1</span>
        </div>
        <div className="wn-git-cap">branch · changes · ahead/behind</div>
      </div>
    )
  }
  if (kind === 'doctor') {
    // A mini agent checklist: rows resolving to installed/missing.
    return (
      <div className="wn-demo wn-demo-doctor">
        <div className="wn-doc-row wn-doc-ok">
          <span className="wn-doc-mark">✓</span> claude <span className="wn-doc-tag">installed</span>
        </div>
        <div className="wn-doc-row wn-doc-ok">
          <span className="wn-doc-mark">✓</span> gemini <span className="wn-doc-tag">installed</span>
        </div>
        <div className="wn-doc-row wn-doc-miss">
          <span className="wn-doc-mark">✕</span> codex
          <span className="wn-doc-cmd">
            <Download size={11} /> Install
          </span>
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

/** A step flattened out of its release, carrying its version + the release kind. */
interface FlatStep {
  version: string
  headline: string
  releaseKind: 'feature' | 'fix' | 'mixed'
  step: WhatsNewStep
}

/**
 * Stepped "What's new" tour. Shows the notes for every version since the user
 * last looked (oldest→newest), flattened into one walk-through with a per-step
 * version pill, so a multi-version jump is one combined tour. Dismissing records
 * the current app version as `lastSeenVersion` so nothing re-shows until the
 * next update.
 */
export default function WhatsNewModal(): JSX.Element | null {
  const versions = useUi((s) => s.whatsNewVersions)
  const setVersions = useUi((s) => s.setWhatsNewVersions)
  const [step, setStep] = useState(0)

  // Flatten every shown version's steps into one ordered sequence.
  const flat: FlatStep[] = useMemo(() => {
    if (!versions) return []
    const out: FlatStep[] = []
    for (const v of versions) {
      const n = notesFor(v)
      if (!n) continue
      for (const s of n.steps) {
        out.push({ version: v, headline: n.headline, releaseKind: n.kind, step: s })
      }
    }
    return out
  }, [versions])

  // Reset to the first step whenever a tour opens (the component stays mounted).
  useEffect(() => {
    if (versions) setStep(0)
  }, [versions])

  if (!versions || !flat.length) return null

  const idx = Math.min(step, flat.length - 1)
  const cur = flat[idx]
  const curKind: 'feature' | 'fix' =
    cur.step.kind ?? (cur.releaseKind === 'fix' ? 'fix' : 'feature')
  const isLast = idx >= flat.length - 1
  const isFirst = idx <= 0
  const multi = versions.length > 1

  // Record the real app version so nothing re-shows until the next update
  // (falls back to the newest shown version if the app info call fails).
  const close = (): void => {
    void window.api
      .getAppInfo()
      .then(({ version }) => useSettings.getState().patch({ prefs: { lastSeenVersion: version } }))
      .catch(() =>
        useSettings.getState().patch({ prefs: { lastSeenVersion: versions[versions.length - 1] } })
      )
    setVersions(null)
  }

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal whatsnew" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header whatsnew-header">
          <div className="whatsnew-title">
            <Rocket size={16} />
            <span>
              {multi ? (
                <>
                  What&apos;s new <b>·</b> {versions[0]} → {versions[versions.length - 1]}
                </>
              ) : (
                <>
                  What&apos;s new <b>·</b> URterminal {versions[0]}
                </>
              )}
            </span>
          </div>
          <button className="icon-btn" onClick={close} title="Close">
            ✕
          </button>
        </div>

        <div className="modal-body whatsnew-body">
          <div className="whatsnew-headline">
            <span className="wn-ver-pill">v{cur.version}</span>
            {cur.headline}
          </div>

          <div className={`whatsnew-step whatsnew-${curKind}`} key={idx}>
            {cur.step.media ? (
              <img className="whatsnew-media" src={cur.step.media} alt="" />
            ) : cur.step.demo ? (
              <WhatsNewDemoView kind={cur.step.demo} />
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
                  <h3>{cur.step.title}</h3>
                </div>
                <p>{cur.step.body}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="whatsnew-footer">
          {/* Step dots — click to jump (version-colored boundaries) */}
          <div className="whatsnew-dots">
            {flat.map((f, i) => (
              <button
                key={i}
                className={
                  `whatsnew-dot ${i === idx ? 'active' : ''}` +
                  (i > 0 && flat[i - 1].version !== f.version ? ' wn-dot-newver' : '')
                }
                aria-label={`${f.version}: ${f.step.title}`}
                title={`v${f.version}`}
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
