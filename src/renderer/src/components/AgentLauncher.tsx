import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { FolderOpen, ArrowRight, ChevronDown, Search, X, Clock, Star } from 'lucide-react'
import type { AgentRuntimeStatus } from '@shared/types'
import {
  LAUNCH_AGENTS,
  STATUS_LABEL,
  type LaunchAgent,
  type AgentStatus
} from '@renderer/lib/launchCatalog'
import { useFolderHistory } from '@renderer/store/folderHistory'
import { AgentLogo } from './brandIcons'

interface Props {
  command: string
  defaultCwd: string
  /** open the agent in `cwd`, arranging the workspace into `layout` (a preset id) */
  onOpen: (cwd: string, layout: string) => void
  onSelectAgent: (command: string) => void
  onClose: () => void
}

const CLI_AGENTS = LAUNCH_AGENTS.filter((a) => !a.configure)

const LAYOUTS: { id: string; n: number; label: string }[] = [
  { id: 'single', n: 1, label: 'Single' },
  { id: '2h', n: 2, label: 'Split' },
  { id: '3l', n: 3, label: 'Main + 2' },
  { id: '4grid', n: 4, label: 'Grid' }
]

/** A tiny numbered tile diagram for a layout option. */
function LayoutDiagram({ id }: { id: string }): JSX.Element {
  if (id === '2h')
    return (
      <div className="al-dia row">
        <span>1</span>
        <span>2</span>
      </div>
    )
  if (id === '3l')
    return (
      <div className="al-dia row">
        <span className="big">1</span>
        <div className="al-dia col">
          <span>2</span>
          <span>3</span>
        </div>
      </div>
    )
  if (id === '4grid')
    return (
      <div className="al-dia grid">
        <span>1</span>
        <span>2</span>
        <span>3</span>
        <span>4</span>
      </div>
    )
  return (
    <div className="al-dia single">
      <span>1</span>
    </div>
  )
}

/** Basename of a path (for the suggestion's primary label). */
function base(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

/** Longest common prefix of a set of strings (for shell-style Tab completion). */
function longestCommonPrefix(strs: string[]): string {
  if (!strs.length) return ''
  let p = strs[0]
  for (const s of strs) {
    while (p && !s.startsWith(p)) p = p.slice(0, -1)
    if (!p) break
  }
  return p
}

/**
 * The agent launcher (shown before an AI pane has a folder): a searchable agent
 * dropdown, a folder field with Last-used / Frequently-used / live-autocomplete
 * suggestions, and a layout picker — then Open.
 */
export default function AgentLauncher({
  command,
  defaultCwd,
  onOpen,
  onSelectAgent,
  onClose
}: Props): JSX.Element {
  const [path, setPath] = useState(defaultCwd)
  const [layout, setLayout] = useState('single')
  const [statuses, setStatuses] = useState<Record<string, AgentRuntimeStatus>>({})
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentQ, setAgentQ] = useState('')
  const [folderOpen, setFolderOpen] = useState(false)
  const [matches, setMatches] = useState<string[]>([])
  // Index of the keyboard-highlighted folder suggestion (-1 = none).
  const [highlight, setHighlight] = useState(-1)
  const recents = useFolderHistory((s) => s.recents)
  const counts = useFolderHistory((s) => s.counts)
  const pathRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.agentStatuses(CLI_AGENTS.map((a) => a.command)).then(setStatuses)
  }, [])

  // Live filesystem autocomplete while the folder dropdown is open.
  useEffect(() => {
    if (!folderOpen) return
    const t = window.setTimeout(() => {
      void window.api.listDirs(path).then(setMatches)
    }, 140)
    return () => window.clearTimeout(t)
  }, [path, folderOpen])

  const statusOf = (cmd: string): AgentStatus => statuses[cmd] ?? 'checking'
  const sel = CLI_AGENTS.find((a) => a.command === command) ?? CLI_AGENTS[0]
  const selStatus = statusOf(sel.command)

  const aq = agentQ.trim().toLowerCase()
  const filteredAgents = aq
    ? CLI_AGENTS.filter((a) => `${a.name} ${a.cli} ${a.model}`.toLowerCase().includes(aq))
    : CLI_AGENTS

  const openFolder = (p: string): void => {
    const v = p.trim()
    if (v) onOpen(v, layout)
  }
  const open = (): void => openFolder(path)
  const browse = async (): Promise<void> => {
    const p = await window.api.pickDirectory(path || undefined)
    if (p) {
      setPath(p)
      setFolderOpen(false)
    }
  }

  // Folder suggestions (filtered by what's typed).
  const nq = path.trim().toLowerCase()
  const lastUsed = recents.filter((p) => !nq || p.toLowerCase().includes(nq)).slice(0, 5)
  const frequent = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p)
    .filter((p) => !lastUsed.includes(p) && (!nq || p.toLowerCase().includes(nq)))
    .slice(0, 5)
  const matchList = matches.filter((p) => !lastUsed.includes(p) && !frequent.includes(p)).slice(0, 8)
  const hasSuggestions = lastUsed.length > 0 || frequent.length > 0 || matchList.length > 0

  // One flat, ordered list of every suggestion for arrow-key navigation. Last-used
  // and frequent entries open the folder; filesystem matches fill the path to drill in.
  const flatSuggestions = [
    ...lastUsed.map((p) => ({ p, action: 'open' as const })),
    ...frequent.map((p) => ({ p, action: 'open' as const })),
    ...matchList.map((p) => ({ p, action: 'fill' as const }))
  ]

  // Reset the highlight whenever the suggestion list changes (typing, open/close).
  useEffect(() => setHighlight(-1), [path, folderOpen, matches])

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (highlight < 0) return
    dropRef.current
      ?.querySelector(`[data-idx="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  // Apply a highlighted suggestion (Enter / click parity).
  const applySuggestion = (item: { p: string; action: 'open' | 'fill' }): void => {
    if (item.action === 'open') openFolder(item.p)
    else {
      setPath(item.p)
      pathRef.current?.focus()
    }
  }

  return (
    <div className="agent-launcher">
      <div className="launcher-card al-card">
        <div className="al-head">
          <span className="al-head-logo">
            <AgentLogo command={sel.command} size={20} />
          </span>
          <div className="al-head-text">
            <div className="al-head-title">Open an agent in a folder</div>
            <div className="al-head-sub">Pick an agent, then choose where it should start.</div>
          </div>
          <button className="icon-btn al-close" onClick={onClose} title="Close pane">
            <X size={15} />
          </button>
        </div>

        {/* ---- agent (searchable dropdown) ---- */}
        <div className="al-label">Agent</div>
        <div className="al-combo">
          {agentOpen ? (
            <div className="al-combo-search">
              <Search size={14} />
              <input
                autoFocus
                value={agentQ}
                placeholder="Search agents…"
                spellCheck={false}
                onChange={(e) => setAgentQ(e.target.value)}
                onBlur={() => window.setTimeout(() => setAgentOpen(false), 120)}
                onKeyDown={(e) => e.key === 'Escape' && setAgentOpen(false)}
              />
            </div>
          ) : (
            <button
              className="al-agent-sel"
              onClick={() => {
                setAgentQ('')
                setAgentOpen(true)
              }}
            >
              <span className="al-agent-badge">
                <AgentLogo command={sel.command} size={18} />
              </span>
              <span className="al-agent-id">
                <span className="al-agent-name">{sel.name}</span>
                <span className="al-agent-meta">
                  {sel.cli} · {sel.model}
                </span>
              </span>
              <span className={clsx('lc-stat', selStatus)}>
                <span className="d" />
                {STATUS_LABEL[selStatus]}
              </span>
              <ChevronDown size={15} className="al-chev" />
            </button>
          )}
          {agentOpen && (
            <div className="al-dropdown">
              {filteredAgents.map((a) => {
                const st = statusOf(a.command)
                return (
                  <button
                    key={a.command}
                    className={clsx('al-opt', a.command === command && 'active')}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onSelectAgent(a.command)
                      setAgentOpen(false)
                    }}
                  >
                    <span className="al-agent-badge">
                      <AgentLogo command={a.command} size={18} />
                    </span>
                    <span className="al-agent-id">
                      <span className="al-agent-name">{a.name}</span>
                      <span className="al-agent-meta">
                        {a.cli} · {a.model}
                      </span>
                    </span>
                    <span className={clsx('lc-stat', st)}>
                      <span className="d" />
                      {STATUS_LABEL[st]}
                    </span>
                  </button>
                )
              })}
              {filteredAgents.length === 0 && (
                <div className="al-empty">No agents match “{agentQ}”.</div>
              )}
            </div>
          )}
        </div>

        {/* ---- folder (suggestions + autocomplete) ---- */}
        <div className="al-label">Folder</div>
        <div className="al-folder-row">
          <div className="al-folder-field">
            <FolderOpen size={14} className="al-folder-ico" />
            <input
              ref={pathRef}
              className="al-folder-input"
              value={path}
              placeholder="Start typing a path, or pick one below…"
              spellCheck={false}
              onChange={(e) => {
                setPath(e.target.value)
                setFolderOpen(true)
              }}
              onFocus={() => setFolderOpen(true)}
              onBlur={() => window.setTimeout(() => setFolderOpen(false), 130)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  if (!folderOpen) {
                    setFolderOpen(true)
                  } else if (flatSuggestions.length) {
                    e.preventDefault()
                    setHighlight((h) => (h + 1) % flatSuggestions.length)
                  }
                } else if (e.key === 'ArrowUp') {
                  if (folderOpen && flatSuggestions.length) {
                    e.preventDefault()
                    setHighlight((h) => (h <= 0 ? flatSuggestions.length - 1 : h - 1))
                  }
                } else if (e.key === 'Enter') {
                  if (folderOpen && highlight >= 0 && highlight < flatSuggestions.length) {
                    e.preventDefault()
                    applySuggestion(flatSuggestions[highlight])
                  } else {
                    open()
                  }
                } else if (e.key === 'Escape') {
                  setFolderOpen(false)
                } else if (e.key === 'Tab' && matches.length) {
                  // Shell-style completion: fill the path to the match(es) instead of
                  // moving focus. Single match → complete it (+ separator to drill in);
                  // multiple → advance to their common prefix and keep the list open.
                  e.preventDefault()
                  setFolderOpen(true)
                  if (matches.length === 1) {
                    const m = matches[0].replace(/[\\/]+$/, '')
                    setPath(m + (m.includes('\\') ? '\\' : '/'))
                  } else {
                    const lcp = longestCommonPrefix(matches)
                    if (lcp.length > path.length) setPath(lcp)
                  }
                }
              }}
            />
            <button
              className="al-folder-chev"
              onMouseDown={(e) => {
                e.preventDefault()
                setFolderOpen((v) => !v)
                pathRef.current?.focus()
              }}
            >
              <ChevronDown size={14} />
            </button>
            {folderOpen && hasSuggestions && (
              <div className="al-dropdown al-folder-drop" ref={dropRef}>
                {lastUsed.length > 0 && (
                  <div className="al-grp">
                    <div className="al-grp-head">
                      <Clock size={11} /> Last used
                    </div>
                    {lastUsed.map((p, i) => (
                      <button
                        key={p}
                        data-idx={i}
                        className={clsx('al-path', highlight === i && 'hl')}
                        title={`Open ${p}`}
                        onMouseEnter={() => setHighlight(i)}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          openFolder(p)
                        }}
                      >
                        <span className="al-path-name">{base(p)}</span>
                        <span className="al-path-full">{p}</span>
                      </button>
                    ))}
                  </div>
                )}
                {frequent.length > 0 && (
                  <div className="al-grp">
                    <div className="al-grp-head">
                      <Star size={11} /> Frequently used
                    </div>
                    {frequent.map((p, i) => {
                      const idx = lastUsed.length + i
                      return (
                        <button
                          key={p}
                          data-idx={idx}
                          className={clsx('al-path', highlight === idx && 'hl')}
                          title={`Open ${p}`}
                          onMouseEnter={() => setHighlight(idx)}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            openFolder(p)
                          }}
                        >
                          <span className="al-path-name">{base(p)}</span>
                          <span className="al-path-full">{p}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
                {matchList.length > 0 && (
                  <div className="al-grp">
                    <div className="al-grp-head">
                      <FolderOpen size={11} /> Folders
                    </div>
                    {matchList.map((p, i) => {
                      const idx = lastUsed.length + frequent.length + i
                      return (
                        <button
                          key={p}
                          data-idx={idx}
                          className={clsx('al-path', highlight === idx && 'hl')}
                          title={p}
                          onMouseEnter={() => setHighlight(idx)}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setPath(p)
                            pathRef.current?.focus()
                          }}
                        >
                          <span className="al-path-name">{base(p)}</span>
                          <span className="al-path-full">{p}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <button className="btn al-browse" onClick={browse} title="Browse…">
            <FolderOpen size={14} /> Browse
          </button>
        </div>

        {/* ---- layout ---- */}
        <div className="al-label">
          Layout <span className="al-label-val">{LAYOUTS.find((l) => l.id === layout)?.label}</span>
        </div>
        <div className="al-layouts">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              className={clsx('al-lay', layout === l.id && 'active')}
              onClick={() => setLayout(l.id)}
            >
              <LayoutDiagram id={l.id} />
              <span className="al-lay-label">
                <b>{l.n}</b> {l.label}
              </span>
            </button>
          ))}
        </div>

        {/* ---- footer + open ---- */}
        <div className="al-foot-note">
          <span className="al-foot-badge">
            <AgentLogo command={sel.command} size={13} />
          </span>
          <b>{sel.name}</b> will start in this folder and ask to trust it on first run.
        </div>
        <button className="btn primary al-open" onClick={open} disabled={!path.trim()}>
          Open {sel.name} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}
