import { useEffect, useMemo, useState } from 'react'
import { FileDiff, Check, X, AlertTriangle, ChevronRight, ChevronDown, FilePlus2, Trash2 } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useDiffReview, type ReviewPatch } from '@renderer/store/diffReview'
import { toast } from '@renderer/store/toasts'

/** A single +/− line, colored by its leading marker. */
function DiffLine({ raw }: { raw: string }): JSX.Element {
  const c = raw[0]
  const kind = c === '+' ? 'add' : c === '-' ? 'del' : 'ctx'
  return <div className={`diff-line ${kind}`}>{raw === '' ? ' ' : raw}</div>
}

function StatusPill({ p }: { p: ReviewPatch }): JSX.Element | null {
  if (p.status === 'applied') return <span className="diff-pill ok"><Check size={11} /> Applied</span>
  if (p.status === 'failed')
    return (
      <span className="diff-pill err" title={p.error}>
        <AlertTriangle size={11} /> Failed
      </span>
    )
  if (p.status === 'skipped') return <span className="diff-pill muted">Skipped</span>
  return null
}

/**
 * Inline diff review & apply: when an agent prints file edits (unified diffs) in
 * its pane, this lists each changed file with an accept checkbox and a colored
 * preview, and writes the approved hunks straight to disk — no copy-paste, no
 * leaving the terminal. Patches are detected by the command/selection that opens
 * this modal; here we only review + apply.
 */
export default function DiffReviewModal(): JSX.Element | null {
  const show = useUi((s) => s.showDiffReview)
  const setShow = useUi((s) => s.setShowDiffReview)
  const { cwd, patches, toggle, setAllSelected, setStatus, reset } = useDiffReview()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)

  // Expand everything when a fresh batch opens — the whole point is to read the
  // changes before applying them.
  useEffect(() => {
    if (show) setExpanded(new Set(patches.map((p) => p.id)))
  }, [show, patches])

  const pending = useMemo(() => patches.filter((p) => p.selected && p.status === 'pending'), [patches])

  if (!show) return null

  const close = (): void => {
    setShow(false)
    reset()
  }

  const toggleExpand = (id: string): void =>
    setExpanded((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const applySelected = async (): Promise<void> => {
    if (!pending.length || applying) return
    setApplying(true)
    let ok = 0
    let failed = 0
    for (const p of pending) {
      try {
        const r = await window.api.applyDiff({
          cwd,
          file: p.file,
          hunks: p.hunks,
          isNew: p.isNew,
          isDelete: p.isDelete
        })
        if (r.ok) {
          setStatus(p.id, 'applied')
          ok++
        } else {
          setStatus(p.id, 'failed', r.error)
          failed++
        }
      } catch (e) {
        setStatus(p.id, 'failed', (e as Error).message)
        failed++
      }
    }
    setApplying(false)
    if (ok && !failed) toast(`Applied ${ok} file${ok === 1 ? '' : 's'}`, 'ok')
    else if (ok && failed) toast(`Applied ${ok}, ${failed} failed`, 'info')
    else toast(`Couldn’t apply ${failed} file${failed === 1 ? '' : 's'}`, 'error')
  }

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal diff-review" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="diff-review-title">
            <FileDiff size={16} />
            <span>Review changes</span>
            <span className="diff-review-count">
              {patches.length} file{patches.length === 1 ? '' : 's'}
            </span>
          </div>
          <button className="icon-btn" onClick={close} title="Close">
            <X size={14} />
          </button>
        </div>

        <div className="diff-review-cwd" title={cwd}>
          {cwd ? <>writes to <code>{cwd}</code></> : <span className="warn">No working folder — applying is disabled</span>}
        </div>

        <div className="modal-body diff-review-body">
          {patches.map((p) => (
            <div key={p.id} className={`diff-file ${p.status}`}>
              <div className="diff-file-head">
                <input
                  type="checkbox"
                  checked={p.selected}
                  disabled={p.status === 'applied'}
                  onChange={() => toggle(p.id)}
                  title="Include in apply"
                />
                <button className="diff-file-toggle" onClick={() => toggleExpand(p.id)}>
                  {expanded.has(p.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                {p.isNew && <FilePlus2 size={12} className="diff-file-icon new" />}
                {p.isDelete && <Trash2 size={12} className="diff-file-icon del" />}
                <span className="diff-file-name" title={p.file}>
                  {p.file}
                </span>
                <span className="diff-stat add">+{p.additions}</span>
                <span className="diff-stat del">−{p.deletions}</span>
                <StatusPill p={p} />
              </div>
              {expanded.has(p.id) && (
                <div className="diff-file-body">
                  {p.hunks.map((h, hi) => (
                    <div key={hi} className="diff-hunk">
                      <div className="diff-hunk-head">
                        @@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
                      </div>
                      {h.lines.map((l, li) => (
                        <DiffLine key={li} raw={l} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="diff-review-actions">
          <button className="btn ghost" onClick={() => setAllSelected(true)}>
            Select all
          </button>
          <button className="btn ghost" onClick={() => setAllSelected(false)}>
            None
          </button>
          <div className="spacer" />
          <button className="btn" onClick={close}>
            Close
          </button>
          <button
            className="btn primary"
            onClick={applySelected}
            disabled={!cwd || !pending.length || applying}
          >
            <Check size={13} /> {applying ? 'Applying…' : `Apply ${pending.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}
