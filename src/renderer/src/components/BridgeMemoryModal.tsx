import { useEffect, useMemo, useRef, useState } from 'react'
import { Network, Search, Plus, Save, Trash2, FolderOpen, X, Link2, ArrowUpRight, List, Share2 } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toasts'
import {
  searchNotes,
  backlinksFor,
  suggestConnections,
  buildGraph,
  type BridgeNote
} from '@shared/bridge'
import BridgeGraph from './BridgeGraph'

/** The cwd of the focused pane — where the `.bridgememory/` hub is discovered. */
function activeCwd(): string {
  const s = useWorkspace.getState()
  const p = s.activePaneId ? s.panes[s.activePaneId] : null
  return p?.agent?.cwd || p?.shell?.cwd || p?.stream?.cwd || ''
}

interface Draft {
  slug: string | null
  title: string
  content: string
}

/**
 * BridgeMemory — a local-first, wikilinked knowledge graph in `.bridgememory/`
 * next to the repo. List + search notes, edit markdown with `[[wikilinks]]`, and
 * see backlinks + suggested connections. Every agent in the room shares this hub
 * (via the MCP server); here a human reads + curates it.
 */
export default function BridgeMemoryModal(): JSX.Element | null {
  const show = useUi((s) => s.showBridge)
  const setShow = useUi((s) => s.setShowBridge)
  const [cwd, setCwd] = useState('')
  const [dir, setDir] = useState('')
  const [notes, setNotes] = useState<BridgeNote[]>([])
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [view, setView] = useState<'list' | 'graph'>('list')
  const titleRef = useRef<HTMLInputElement>(null)

  const refresh = async (c: string): Promise<BridgeNote[]> => {
    const r = await window.api.bridge.list(c)
    setDir(r.dir)
    setNotes(r.notes)
    return r.notes
  }

  useEffect(() => {
    if (!show) return
    const c = activeCwd()
    setCwd(c)
    setSel(null)
    setDraft(null)
    setQuery('')
    if (c) void refresh(c)
    else {
      setNotes([])
      setDir('')
    }
  }, [show])

  const results = useMemo(() => searchNotes(notes, query), [notes, query])
  const graph = useMemo(() => buildGraph(notes), [notes])
  const current = sel ? notes.find((n) => n.slug === sel) : null
  const backlinks = useMemo(() => (sel ? backlinksFor(notes, sel) : []), [notes, sel])
  const suggestions = useMemo(() => (sel ? suggestConnections(notes, sel) : []), [notes, sel])

  if (!show) return null

  const close = (): void => setShow(false)

  const select = (slug: string): void => {
    const n = notes.find((x) => x.slug === slug)
    setSel(slug)
    setDraft(n ? { slug, title: n.title, content: n.content } : { slug: null, title: slug, content: '' })
  }

  const startNew = (): void => {
    setSel(null)
    setDraft({ slug: null, title: '', content: '' })
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const save = async (override?: Draft): Promise<void> => {
    const d = override ?? draft
    if (!d || !cwd) return
    if (!d.title.trim() && !d.content.trim()) {
      toast('Give the note a title first', 'info')
      return
    }
    const r = await window.api.bridge.save(cwd, d.slug, d.title.trim() || 'Untitled', d.content)
    if (!r.ok) {
      toast(r.error || 'Could not save', 'error')
      return
    }
    const fresh = await refresh(cwd)
    const saved = fresh.find((n) => n.slug === r.slug)
    setSel(r.slug ?? null)
    setDraft(saved ? { slug: saved.slug, title: saved.title, content: saved.content } : d)
    toast('Saved', 'ok')
  }

  const remove = async (): Promise<void> => {
    if (!sel || !cwd) return
    await window.api.bridge.remove(cwd, sel)
    await refresh(cwd)
    setSel(null)
    setDraft(null)
    toast('Deleted', 'ok')
  }

  const linkTo = (slug: string): void => {
    if (!draft) return
    const sep = draft.content && !draft.content.endsWith('\n') ? '\n' : ''
    const next = { ...draft, content: `${draft.content}${sep}See also [[${slug}]].\n` }
    setDraft(next)
    void save(next)
  }

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal bridge" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="bridge-title">
            <Network size={16} />
            <span>BridgeMemory</span>
            <span className="bridge-count">
              {notes.length} note{notes.length === 1 ? '' : 's'} · {graph.edges.length} links
            </span>
          </div>
          <div className="bridge-head-actions">
            {cwd && (
              <div className="bridge-viewtoggle">
                <button
                  className={`icon-btn ${view === 'list' ? 'on' : ''}`}
                  title="List view"
                  onClick={() => setView('list')}
                >
                  <List size={14} />
                </button>
                <button
                  className={`icon-btn ${view === 'graph' ? 'on' : ''}`}
                  title="Graph view"
                  onClick={() => setView('graph')}
                >
                  <Share2 size={14} />
                </button>
              </div>
            )}
            {dir && (
              <button className="icon-btn" title={dir} onClick={() => window.api.bridge.reveal(cwd)}>
                <FolderOpen size={14} />
              </button>
            )}
            <button className="icon-btn" onClick={close} title="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        {!cwd ? (
          <div className="bridge-empty">
            Open an agent or shell pane in a folder, then reopen BridgeMemory — the hub lives in a{' '}
            <code>.bridgememory/</code> folder next to that repo.
          </div>
        ) : view === 'graph' ? (
          <div className="bridge-body bridge-body-graph">
            <BridgeGraph
              notes={notes}
              selected={sel}
              onSelect={(s) => {
                select(s)
                setView('list')
              }}
            />
          </div>
        ) : (
          <div className="bridge-body">
            <div className="bridge-list">
              <div className="bridge-search">
                <Search size={13} />
                <input
                  className="input"
                  placeholder="Search notes…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="btn" onClick={startNew} title="New note">
                  <Plus size={13} />
                </button>
              </div>
              <div className="bridge-items">
                {results.length === 0 && (
                  <div className="bridge-hint">
                    {notes.length ? 'No matches.' : 'No notes yet — create your first.'}
                  </div>
                )}
                {results.map((n) => (
                  <button
                    key={n.slug}
                    className={`bridge-item ${sel === n.slug ? 'sel' : ''}`}
                    onClick={() => select(n.slug)}
                  >
                    <div className="bridge-item-title">{n.title}</div>
                    {n.excerpt && <div className="bridge-item-ex">{n.excerpt}</div>}
                    <div className="bridge-item-meta">
                      {n.tags.slice(0, 4).map((t) => (
                        <span key={t} className="bridge-tag">
                          #{t}
                        </span>
                      ))}
                      {n.links.length > 0 && (
                        <span className="bridge-linkcount">
                          <Link2 size={10} /> {n.links.length}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="bridge-editor">
              {!draft ? (
                <div className="bridge-hint bridge-pick">Select a note, or create one.</div>
              ) : (
                <>
                  <input
                    ref={titleRef}
                    className="input bridge-titlein"
                    placeholder="Note title"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                  <textarea
                    className="input mono bridge-content"
                    placeholder="Markdown… link other notes with [[wikilinks]] and tag with #topic"
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  />
                  <div className="bridge-editor-actions">
                    <button className="btn primary" onClick={() => void save()}>
                      <Save size={13} /> Save
                    </button>
                    {sel && (
                      <button className="btn danger" onClick={() => void remove()}>
                        <Trash2 size={13} /> Delete
                      </button>
                    )}
                  </div>

                  {current && (backlinks.length > 0 || suggestions.length > 0) && (
                    <div className="bridge-rel">
                      {backlinks.length > 0 && (
                        <div className="bridge-rel-group">
                          <div className="bridge-rel-head">Backlinks</div>
                          {backlinks.map((b) => (
                            <button key={b.slug} className="bridge-rel-item" onClick={() => select(b.slug)}>
                              <ArrowUpRight size={11} /> {b.title}
                            </button>
                          ))}
                        </div>
                      )}
                      {suggestions.length > 0 && (
                        <div className="bridge-rel-group">
                          <div className="bridge-rel-head">Suggested connections</div>
                          {suggestions.map((s) => (
                            <div key={s.note.slug} className="bridge-sugg">
                              <button className="bridge-rel-item" onClick={() => select(s.note.slug)}>
                                {s.note.title}
                              </button>
                              <span className="bridge-sugg-shared">{s.shared.join(' ')}</span>
                              <button className="bridge-link-btn" title="Link this note" onClick={() => linkTo(s.note.slug)}>
                                <Link2 size={11} /> link
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
