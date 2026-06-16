import type { Pane } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import { useUi } from '@renderer/store/ui'
import { useSidebar } from '@renderer/store/sidebar'
import { useBroadcastStore } from '@renderer/store/broadcast'
import { useSettings } from '@renderer/store/settings'
import { useActivity, activityToMarkdown } from '@renderer/store/activity'
import { broadcastActiveLine } from '@renderer/hooks/useBroadcast'
import { insertSnippet } from '@renderer/lib/snippets'
import { runMacro } from '@renderer/lib/macros'
import { getShellSpecs } from '@renderer/lib/shells'
import { getAgents } from '@renderer/lib/agents'
import {
  copySelection,
  pasteClipboard,
  jumpBookmark,
  exportPaneHtml,
  getFullText
} from '@renderer/lib/terminalPool'
import { confirmPaneClose } from '@renderer/lib/paneClose'
import { injectText } from '@renderer/lib/inject'
import { parsePatches } from '@shared/diff'
import { useDiffReview } from '@renderer/store/diffReview'
import { enhanceActivePrompt } from '@renderer/lib/enhance'
import { summarizeActiveSession } from '@renderer/lib/summarize'
import { allNotes } from '@renderer/lib/whatsNew'
import { toast } from '@renderer/store/toasts'

export interface Command {
  id: string
  title: string
  group: string
  /** human-readable shortcut hint, e.g. "Ctrl+T" */
  shortcut?: string
  /** hidden from the palette list but still runnable by id */
  hidden?: boolean
  run: () => void
}

const ws = (): ReturnType<typeof useWorkspace.getState> => useWorkspace.getState()
const ui = (): ReturnType<typeof useUi.getState> => useUi.getState()

function activePane(): Pane | null {
  const s = ws()
  return (s.activePaneId && s.panes[s.activePaneId]) || null
}

/** Switch to the workspace `offset` tabs away from the active one (wraps around). */
function switchWorkspaceBy(offset: number): void {
  const { list, activeId, switchTo } = useWorkspaces.getState()
  if (list.length < 2) return
  const idx = list.findIndex((w) => w.id === activeId)
  if (idx < 0) return
  switchTo(list[(idx + offset + list.length) % list.length].id)
}

/** Nudge the whole-app UI zoom by `delta` (clamped), persisting it. */
function adjustZoom(delta: number): void {
  const cur = useSettings.getState().settings?.prefs.uiZoom ?? 1
  const next = Math.max(0.6, Math.min(2, Math.round((cur + delta) * 10) / 10))
  void useSettings.getState().patch({ prefs: { uiZoom: next } })
}

/** Save the active pane's buffer to an HTML or plain-text file. */
function exportActivePane(fmt: 'html' | 'text'): void {
  const p = activePane()
  if (!p) {
    toast('Focus a pane first', 'info')
    return
  }
  const title = (p.title || p.agent?.command || p.shell?.shell || 'session').replace(/[^\w.-]+/g, '_')
  const contents = fmt === 'html' ? exportPaneHtml(p.id) : getFullText(p.id)
  if (!contents.trim()) {
    toast('Nothing to export yet', 'info')
    return
  }
  void window.api
    .saveFile({ defaultName: `${title}.${fmt === 'html' ? 'html' : 'txt'}`, contents })
    .then((r) => {
      if (r.ok) toast(`Exported to ${r.path}`, 'ok')
      else if (!r.canceled) toast(`Export failed: ${r.error ?? ''}`, 'error')
    })
    .catch(() => {})
}

/** Scan the active pane's output for unified diffs and open the review modal. */
function reviewDiffFromActivePane(): void {
  const p = activePane()
  if (!p) {
    toast('Focus a pane first', 'info')
    return
  }
  const patches = parsePatches(getFullText(p.id))
  if (!patches.length) {
    toast('No file diffs found in this pane', 'info')
    return
  }
  const cwd = p.agent?.cwd || p.shell?.cwd || ''
  useDiffReview.getState().open(patches, cwd)
  ui().setShowDiffReview(true)
}

/** Run `command` in the active AI pane, or spin up a new one. */
function runAgent(command: string): void {
  const pane = activePane()
  if (pane?.type === 'ai') {
    ws().setAgent(pane.id, command)
  } else {
    const id = ws().addPane('ai')
    ws().setAgent(id, command)
  }
}

/** Build the full command list against the current store state. */
export function getCommands(): Command[] {
  const cmds: Command[] = [
    // ---- panes ----
    {
      id: 'pane.newAi',
      title: 'New agent pane (claude)',
      group: 'Panes',
      shortcut: 'Ctrl+T',
      run: () => ws().addPane('ai')
    },
    {
      id: 'pane.newShell',
      title: 'New shell pane',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+5',
      run: () => ws().addPane('shell')
    },
    {
      id: 'pane.newStream',
      title: 'New stream pane (Claude, structured cards)',
      group: 'Panes',
      run: () => ws().addPane('stream', undefined, { agentCommand: 'claude', label: 'claude · stream' })
    },
    {
      id: 'pane.newOpenRouter',
      title: 'New OpenRouter chat pane (200+ models)',
      group: 'Panes',
      run: () => ws().addPane('openrouter', undefined, { label: 'OpenRouter' })
    },
    {
      id: 'app.toggleSidebar',
      title: 'Toggle sidebar (pin open / hover)',
      group: 'View',
      shortcut: 'Ctrl+B',
      run: () => useSidebar.getState().togglePinned()
    },
    {
      id: 'nav.quickSwitch',
      title: 'Switch to pane…',
      group: 'Panes',
      shortcut: 'Ctrl+P',
      run: () => ui().toggleQuickSwitch()
    },
    {
      id: 'nav.searchHistory',
      title: 'Search past conversations…',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+F',
      run: () => ui().toggleSessionSearch()
    },
    {
      id: 'nav.prevPrompt',
      title: 'Jump to previous prompt',
      group: 'Panes',
      shortcut: 'Alt+Up',
      run: () => {
        const p = activePane()
        if (p) jumpBookmark(p.id, 'prev')
      }
    },
    {
      id: 'nav.nextPrompt',
      title: 'Jump to next prompt',
      group: 'Panes',
      shortcut: 'Alt+Down',
      run: () => {
        const p = activePane()
        if (p) jumpBookmark(p.id, 'next')
      }
    },
    {
      id: 'pane.runInShells',
      title: 'Run a command in all shells…',
      group: 'Panes',
      run: () => ui().setShowRunCommand(true)
    },
    {
      id: 'pane.insertReference',
      title: 'Insert context: @diff, @url, @file…',
      group: 'Panes',
      run: () => ui().setShowInsertReference(true)
    },
    {
      id: 'pane.delegate',
      title: 'Delegate a task to a subagent…',
      group: 'Panes',
      run: () => ui().setShowDelegate(true)
    },
    {
      id: 'pane.orchestrate',
      title: 'Orchestrate a goal across agents…',
      group: 'Panes',
      run: () => ui().setShowOrchestrate(true)
    },
    {
      id: 'pane.reviewDiff',
      title: 'Review & apply code changes from this pane…',
      group: 'Panes',
      run: reviewDiffFromActivePane
    },
    {
      id: 'app.mcp',
      title: 'Configure MCP servers (this folder)…',
      group: 'App',
      run: () => ui().setShowMcp(true)
    },
    {
      id: 'app.bridge',
      title: 'BridgeMemory: project notes & links…',
      group: 'App',
      shortcut: 'Ctrl+Shift+M',
      run: () => ui().setShowBridge(true)
    },
    {
      id: 'app.rooms',
      title: 'Open a Room: Command · Swarm · Review…',
      group: 'App',
      shortcut: 'Ctrl+Shift+R',
      run: () => ui().setShowRooms(true)
    },
    {
      id: 'app.tasks',
      title: 'Task board (this project)…',
      group: 'App',
      shortcut: 'Ctrl+Shift+B',
      run: () => ui().setShowTasks(true)
    },
    {
      id: 'app.timeline',
      title: 'Build timeline (watch the loop)…',
      group: 'App',
      run: () => ui().setShowTimeline(true)
    },
    {
      id: 'ssh.connect',
      title: 'SSH connections manager…',
      group: 'Panes',
      run: () => ui().setShowSshPrompt(true)
    },
    {
      id: 'ssh.installSshfs',
      title: 'SSH: Install remote-folder mount (SSHFS-Win)',
      group: 'Panes',
      run: () => {
        void window.api.sshfsStatus().then((s) => {
          if (s.installed) {
            toast('SSHFS-Win is already installed', 'ok')
            return
          }
          void window.api.sshfsInstall().then((r) => {
            if (r.ok) toast('Installing SSHFS-Win in a console — approve the UAC prompt, then restart URterminal.', 'info')
            else toast(`Install failed to start: ${r.error ?? 'unknown'}`, 'error')
          })
        })
      }
    },
    {
      id: 'pane.splitRight',
      title: 'Split active pane → right (duplicate)',
      group: 'Panes',
      shortcut: 'Ctrl+D',
      run: () => {
        const id = ws().activePaneId
        if (id) ws().duplicatePane(id, 'row')
        else ws().addPane('ai', 'row')
      }
    },
    {
      id: 'pane.splitDown',
      title: 'Split active pane → down (duplicate)',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+D',
      run: () => {
        const id = ws().activePaneId
        if (id) ws().duplicatePane(id, 'column')
        else ws().addPane('ai', 'column')
      }
    },
    {
      id: 'pane.close',
      title: 'Close active pane',
      group: 'Panes',
      shortcut: 'Ctrl+W',
      run: () => {
        const id = ws().activePaneId
        if (!id) return
        void (async () => {
          if (await confirmPaneClose(id)) {
            window.api.linkPaneToTelegram(id, null)
            ws().removePane(id)
          }
        })()
      }
    },
    {
      id: 'pane.reopen',
      title: 'Reopen closed pane',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+T',
      run: () => ws().reopenClosed()
    },
    {
      id: 'pane.openTerminal',
      title: 'Open terminal in agent folder',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+O',
      run: () => {
        const id = ws().activePaneId
        if (id) ws().openTerminalHere(id)
      }
    },
    {
      id: 'pane.search',
      title: 'Search scrollback in active pane',
      group: 'Panes',
      shortcut: 'Ctrl+F',
      run: () => ui().setSearchOpen(true)
    },
    {
      id: 'pane.zoom',
      title: 'Toggle zoom (maximize) active pane',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+Enter',
      run: () => {
        const id = ws().activePaneId
        if (id) ui().toggleZoom(id)
      }
    },
    {
      id: 'pane.saveTemplate',
      title: 'Save active pane as template…',
      group: 'Panes',
      run: () => {
        const id = ws().activePaneId
        if (id) ui().setSavingTemplatePaneId(id)
      }
    },
    {
      id: 'pane.linkTelegram',
      title: 'Link active pane to Telegram…',
      group: 'Panes',
      run: () => {
        const id = ws().activePaneId
        if (id) ui().setLinkingPaneId(id)
      }
    },
    {
      id: 'pane.screenshot',
      title: 'Screenshot active pane → Telegram',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+S',
      run: () => {
        const id = ws().activePaneId
        if (id) void window.api.screenshotPane(id)
      }
    },

    // ---- clipboard ----
    {
      id: 'edit.copy',
      title: 'Copy selection',
      group: 'General',
      shortcut: 'Ctrl+Shift+C',
      run: () => {
        const id = ws().activePaneId
        if (id) copySelection(id)
      }
    },
    {
      id: 'edit.paste',
      title: 'Paste into terminal (text or image)',
      group: 'General',
      shortcut: 'Ctrl+V',
      run: () => {
        const id = ws().activePaneId
        if (id) pasteClipboard(id)
      }
    },

    // ---- broadcast ----
    {
      id: 'broadcast.toggle',
      title: 'Toggle broadcast input mode',
      group: 'Agent',
      run: () => useBroadcastStore.getState().toggle()
    },
    {
      id: 'broadcast.send',
      title: 'Broadcast typed line to selected panes',
      group: 'Agent',
      shortcut: 'Ctrl+Enter',
      run: () => broadcastActiveLine()
    },
    {
      id: 'agent.askAll',
      title: 'Ask all agents… (compare answers)',
      group: 'Agent',
      run: () => ui().setShowAskAll(true)
    },

    // ---- agent ----
    {
      id: 'agent.restart',
      title: 'Restart agent in active pane',
      group: 'Agent',
      run: () => {
        const pane = activePane()
        if (pane?.type === 'ai' && pane.agent) ws().setAgent(pane.id, pane.agent.command)
      }
    },

    // ---- workspaces ----
    {
      id: 'workspace.next',
      title: 'Next workspace',
      group: 'Workspaces',
      shortcut: 'Ctrl+Tab',
      run: () => switchWorkspaceBy(1)
    },
    {
      id: 'workspace.prev',
      title: 'Previous workspace',
      group: 'Workspaces',
      shortcut: 'Ctrl+Shift+Tab',
      run: () => switchWorkspaceBy(-1)
    },

    // ---- app ----
    {
      id: 'app.newWindow',
      title: 'New window',
      group: 'App',
      shortcut: 'Ctrl+Shift+N',
      run: () => window.api.openNewWindow()
    },
    {
      id: 'app.settings',
      title: 'Open settings',
      group: 'App',
      shortcut: 'Ctrl+,',
      run: () => ui().setShowSettings(true)
    },
    {
      id: 'app.shortcuts',
      title: 'Keyboard shortcuts',
      group: 'App',
      shortcut: 'Ctrl+/',
      run: () => ui().setShowShortcuts(true)
    },
    {
      id: 'app.agentDoctor',
      title: 'Check agent setup (Agent doctor)',
      group: 'App',
      run: () => ui().setShowAgentDoctor(true)
    },
    {
      id: 'app.zoomIn',
      title: 'Zoom in (app UI)',
      group: 'App',
      shortcut: 'Ctrl+=',
      run: () => adjustZoom(0.1)
    },
    {
      id: 'app.zoomOut',
      title: 'Zoom out (app UI)',
      group: 'App',
      shortcut: 'Ctrl+-',
      run: () => adjustZoom(-0.1)
    },
    {
      id: 'app.zoomReset',
      title: 'Reset UI zoom',
      group: 'App',
      shortcut: 'Ctrl+0',
      run: () => void useSettings.getState().patch({ prefs: { uiZoom: 1 } })
    },
    {
      id: 'pane.exportHtml',
      title: 'Export this pane as HTML…',
      group: 'App',
      run: () => exportActivePane('html')
    },
    {
      id: 'pane.exportText',
      title: 'Export this pane as text…',
      group: 'App',
      run: () => exportActivePane('text')
    },
    {
      id: 'app.reload',
      title: 'Reload window',
      group: 'App',
      run: () => location.reload()
    },
    {
      id: 'agent.summarize',
      title: 'Summarize this session (copy digest)',
      group: 'App',
      run: () => summarizeActiveSession()
    },
    {
      id: 'app.whatsNew',
      title: "What's new",
      group: 'App',
      run: () => {
        const all = allNotes()
        if (!all.length) {
          toast('No release notes available yet', 'info')
          return
        }
        // Full changelog: every version, oldest → newest.
        ui().setWhatsNewVersions(all.map((n) => n.version))
      }
    },

    // ---- session activity log ----
    {
      id: 'session.exportLog',
      title: 'Export session activity log (Markdown)…',
      group: 'App',
      run: () => {
        const entries = useActivity.getState().entries
        if (!entries.length) {
          toast('No activity recorded yet', 'info')
          return
        }
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        void window.api
          .saveFile({ defaultName: `urterminal-activity-${stamp}.md`, contents: activityToMarkdown(entries) })
          .then((r) => {
            if (r.ok) toast('Activity log exported', 'ok')
            else if (!r.canceled) toast(`Export failed: ${r.error ?? 'unknown error'}`, 'error')
          })
      }
    },
    {
      id: 'session.clearLog',
      title: 'Clear session activity log',
      group: 'App',
      run: () => {
        useActivity.getState().clear()
        toast('Activity log cleared', 'ok')
      }
    },

    // ---- learning layer (Hermes) ----
    {
      id: 'learning.distill',
      title: 'Learning: Run distillation now',
      group: 'Learning',
      run: () => {
        toast('Running distillation…', 'info')
        void window.api.learning
          .distill()
          .then((r) =>
            toast(
              r.ok
                ? `Distilled — ${r.applied ?? 0} applied, ${r.queued ?? 0} queued`
                : `Distillation failed: ${r.error ?? 'learning/egress disabled?'}`,
              r.ok ? 'ok' : 'error'
            )
          )
          .catch((e) => toast(`Distillation failed: ${(e as Error).message}`, 'error'))
      }
    },
    {
      id: 'learning.openStore',
      title: 'Learning: Open brain store folder',
      group: 'Learning',
      run: () => void window.api.learning.openStore().catch(() => {})
    },
    {
      id: 'learning.settings',
      title: 'Learning: Open settings',
      group: 'Learning',
      run: () => ui().openSettings('learning')
    },
    {
      id: 'learning.enhancePrompt',
      title: 'Enhance prompt with memory (active agent)',
      group: 'Learning',
      run: () => enhanceActivePrompt()
    },

    // ---- Google Tasks ----
    {
      id: 'googleTasks.agenda',
      title: 'Google Tasks: Insert my agenda into the active pane',
      group: 'Integrations',
      run: () => {
        void window.api
          .googleTasksAgenda()
          .then((text) => {
            const id = ws().activePaneId
            if (id && injectText(id, text, false)) toast('Inserted Google Tasks agenda', 'ok')
            else toast('Open a pane first to insert the agenda', 'info')
          })
          .catch((e) => toast(`Google Tasks: ${(e as Error).message}`, 'error'))
      }
    }
  ]

  // a "new pane" + "switch active pane" command for each discovered agent CLI
  for (const { id, label } of getAgents()) {
    cmds.push({
      id: `agent.new.${id}`,
      title: `New ${label} agent pane`,
      group: 'Agent',
      run: () => ws().addPane('ai', undefined, { agentCommand: id, label })
    })
    cmds.push({
      id: `agent.run.${id}`,
      title: `Switch active pane → ${label}`,
      group: 'Agent',
      run: () => runAgent(id)
    })
  }

  // a "new pane" command for each available shell (PowerShell, cmd, WSL distros…)
  for (const sh of getShellSpecs()) {
    cmds.push({
      id: `shell.new.${sh.id}`,
      title: `New ${sh.label} terminal`,
      group: 'Shells',
      run: () =>
        ws().addPane('shell', undefined, { shell: sh.file, shellArgs: sh.args, label: sh.label })
    })
  }

  // a "insert" command for each saved snippet
  const snippets = useSettings.getState().settings?.prefs.snippets ?? []
  for (const sn of snippets) {
    cmds.push({
      id: `snippet.insert.${sn.id}`,
      title: `Insert ${sn.kind === 'shell' ? 'command' : 'prompt'}: ${sn.name}`,
      group: 'Snippets',
      run: () => insertSnippet(sn)
    })
  }

  // a "run" command for each saved macro (replays its steps into the active pane)
  const macros = useSettings.getState().settings?.prefs.macros ?? []
  for (const mc of macros) {
    cmds.push({
      id: `macro.run.${mc.id}`,
      title: `Run macro: ${mc.name}`,
      group: 'Macros',
      run: () => runMacro(mc)
    })
  }

  // focus pane 1..n (hidden from the list; reachable via Ctrl+1..9)
  const count = Object.keys(ws().panes).length
  for (let i = 0; i < Math.min(count, 9); i++) {
    cmds.push({
      id: `pane.focus.${i + 1}`,
      title: `Focus pane ${i + 1}`,
      group: 'Panes',
      shortcut: `Ctrl+${i + 1}`,
      hidden: true,
      run: () => ws().focusByIndex(i)
    })
  }

  return cmds
}

/** Run a command by id (used by the hotkey layer). */
export function runCommand(id: string): void {
  getCommands().find((c) => c.id === id)?.run()
}
