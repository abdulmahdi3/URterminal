import type { Pane, PaneTemplate } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { useSettings } from '@renderer/store/settings'
import { toast } from '@renderer/store/toasts'

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function templates(): PaneTemplate[] {
  return useSettings.getState().settings?.prefs.templates ?? []
}

/** Spawn a new pane from a saved template (agent+folder, or shell+cwd+startup). */
export function spawnTemplate(t: PaneTemplate): void {
  const ws = useWorkspace.getState()
  if (t.type === 'ai') {
    const command = t.agentCommand || 'claude'
    const id = ws.addPane('ai', undefined, { agentCommand: command, label: t.name })
    if (!id) {
      toast('Max 9 panes reached', 'info')
      return
    }
    // addPane already minted the pinned sessionId — keep it, just add the folder
    const agent = useWorkspace.getState().panes[id]?.agent
    ws.updatePane(id, { agent: { ...agent, command, cwd: t.cwd }, title: t.name })
  } else {
    const id = ws.addPane('shell', undefined, { shell: t.shell, shellArgs: t.shellArgs, label: t.name })
    if (!id) {
      toast('Max 9 panes reached', 'info')
      return
    }
    ws.updatePane(id, {
      shell: { shell: t.shell || '', args: t.shellArgs, cwd: t.cwd, startupCommand: t.startupCommand },
      title: t.name
    })
  }
  toast(`Opened template: ${t.name}`, 'ok')
}

/** Build a template definition from a live pane's current configuration. */
export function templateFromPane(pane: Pane, name: string): PaneTemplate | null {
  if (pane.type === 'ai' && pane.agent) {
    return { id: uid(), name, type: 'ai', agentCommand: pane.agent.command, cwd: pane.agent.cwd }
  }
  if (pane.type === 'shell' && pane.shell) {
    return {
      id: uid(),
      name,
      type: 'shell',
      shell: pane.shell.shell,
      shellArgs: pane.shell.args,
      cwd: pane.shell.cwd,
      startupCommand: pane.shell.startupCommand
    }
  }
  return null
}

export function addTemplate(t: PaneTemplate): void {
  void useSettings.getState().patch({ prefs: { templates: [...templates(), t] } })
}

export function removeTemplate(id: string): void {
  void useSettings.getState().patch({ prefs: { templates: templates().filter((t) => t.id !== id) } })
}
