import { useWorkspace } from '@renderer/store/workspace'
import { useSettings } from '@renderer/store/settings'
import { getPaneSelection } from '@renderer/lib/terminalPool'
import { askAllAgents, injectText, liveAiPaneIds } from '@renderer/lib/inject'
import { toast } from '@renderer/store/toasts'

/** Common translation targets offered in settings. */
export const LANGUAGES = [
  'English', 'Arabic', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
  'Russian', 'Turkish', 'Chinese', 'Japanese', 'Korean', 'Hindi', 'Urdu',
  'Persian', 'Dutch', 'Swedish', 'Polish', 'Ukrainian', 'Indonesian'
]

/** Build the translation task/prompt sent to an agent. */
export function translationPrompt(text: string, language: string): string {
  return `Translate the following text to ${language}. Reply with only the translation, no commentary:\n\n${text}`
}

/**
 * "Live translation": take the text currently selected in the active pane, wrap
 * it as a translation task for the configured default language, and send it as a
 * prompt to every open agent. If no agent is open, fall back to the active pane.
 */
export function translateSelection(): void {
  const paneId = useWorkspace.getState().activePaneId
  const selection = (paneId ? getPaneSelection(paneId) : '').trim()
  if (!selection) {
    toast('Select some text in a pane first', 'info')
    return
  }
  const language = useSettings.getState().settings?.prefs.defaultLanguage || 'English'
  const prompt = translationPrompt(selection, language)

  if (liveAiPaneIds().length > 0) {
    const n = askAllAgents(prompt)
    toast(`Translating to ${language} in ${n} agent${n === 1 ? '' : 's'}`, 'ok')
    return
  }
  // No agent open — start one and send the prompt there.
  const id = useWorkspace.getState().addPane('ai')
  if (!id) {
    toast('Max 9 panes reached', 'info')
    return
  }
  // Give the new agent a moment to boot before pasting the prompt.
  let tries = 0
  const trySend = (): void => {
    if (injectText(id, prompt, true)) {
      toast(`Translating to ${language}`, 'ok')
      return
    }
    if (tries++ < 40) window.setTimeout(trySend, 250)
  }
  window.setTimeout(trySend, 400)
}
