import { useEffect } from 'react'
import clsx from 'clsx'
import TitleBar from './components/TitleBar'
import Workspace from './components/Workspace'
import StatusBar from './components/StatusBar'
import CommandPalette from './components/CommandPalette'
import ShortcutsModal from './components/ShortcutsModal'
import SettingsModal from './components/SettingsModal'
import TelegramLinkModal from './components/TelegramLinkModal'
import TaskManagerModal from './components/TaskManagerModal'
import AskAllModal from './components/AskAllModal'
import SnippetFillModal from './components/SnippetFillModal'
import TemplateSaveModal from './components/TemplateSaveModal'
import SshConnectModal from './components/SshConnectModal'
import NotesModal from './components/NotesModal'
import QuickSwitcher from './components/QuickSwitcher'
import AgentDoctorModal from './components/AgentDoctorModal'
import RunCommandModal from './components/RunCommandModal'
import SessionSearchModal from './components/SessionSearchModal'
import InsertReferenceModal from './components/InsertReferenceModal'
import McpModal from './components/McpModal'
import DelegateModal from './components/DelegateModal'
import WhatsNewModal from './components/WhatsNewModal'
import ConfirmDialog from './components/ConfirmDialog'
import UpdateToast from './components/UpdateToast'
import SearchBar from './components/SearchBar'
import Toaster from './components/Toaster'
import CopiedFlash from './components/CopiedFlash'
import SelectionTranslate from './components/SelectionTranslate'
import { useSettings } from './store/settings'
import { useUi } from './store/ui'
import { wireUpdater } from './store/updater'
import { startMetricsLoop } from './store/metrics'
import { startClaudeUsageLoop } from './store/claudeUsage'
import { useHotkeys } from './hooks/useHotkeys'
import { usePersistence } from './hooks/usePersistence'
import { useChainForwarding } from './hooks/useChainForwarding'
import { useTelegramForwarding } from './hooks/useTelegramForwarding'
import { usePaneRegistry } from './hooks/usePaneRegistry'
import { useBroadcast } from './hooks/useBroadcast'
import { usePaneActivity } from './hooks/usePaneActivity'
import { useDoneNotifications } from './hooks/useDoneNotifications'
import { useDoneGlow } from './hooks/useDoneGlow'
import { useWorkspaceBadges } from './hooks/useWorkspaceBadges'
import { useActivityLog } from './hooks/useActivityLog'
import { useWhatsNew } from './hooks/useWhatsNew'
import { useBudgetWarnings } from './hooks/useBudgetWarnings'
import { useAgentDoctor } from './hooks/useAgentDoctor'
import { useNotificationFeed } from './hooks/useNotificationFeed'
import { refreshWslDistros } from './lib/shells'
import { refreshAgentAvailability } from './lib/agents'
import { primeOsInfo } from './lib/osInfo'

export default function App(): JSX.Element {
  const load = useSettings((s) => s.load)
  const appTheme = useUi((s) => s.appTheme)

  useHotkeys()
  usePersistence()
  useChainForwarding()
  useTelegramForwarding()
  usePaneRegistry()
  useBroadcast()
  usePaneActivity()
  useDoneNotifications()
  useDoneGlow()
  useWorkspaceBadges()
  useActivityLog()
  useWhatsNew()
  useBudgetWarnings()
  useAgentDoctor()
  useNotificationFeed()

  // Mirror the theme class onto <body> too, so popovers/menus that portal out
  // of the .app root (HeaderPopover, etc.) still inherit the themed CSS vars
  // instead of falling back to the dark :root defaults.
  useEffect(() => {
    const cls = appTheme !== 'dark' ? `theme-${appTheme}` : ''
    for (const c of Array.from(document.body.classList)) {
      if (c.startsWith('theme-')) document.body.classList.remove(c)
    }
    if (cls) document.body.classList.add(cls)
  }, [appTheme])

  useEffect(() => {
    // Expose zoom control so the main process can zoom a pane for screenshots
    ;(window as unknown as Record<string, unknown>).__setZoomedPane =
      (id: string | null) => useUi.getState().setZoomedPaneId(id)
    return () => {
      delete (window as unknown as Record<string, unknown>).__setZoomedPane
    }
  }, [])

  useEffect(() => {
    void load()
    wireUpdater() // bind main-process updater events to the shared store (once)
    void primeOsInfo() // cache the real home dir from main (renderer env is unreliable)
    void refreshWslDistros() // populate the shell launcher with installed WSL distros
    void refreshAgentAvailability() // flag which agent CLIs are actually installed
    const stopMetrics = startMetricsLoop()
    const stopClaudeUsage = startClaudeUsageLoop()
    const offSettings = window.api.onSettingsChanged((s) => useSettings.getState().apply(s))
    // Inbound Telegram messages are handled in useTelegramForwarding, which also
    // arms answer-tracking so replies are sent back to the chat.

    return () => {
      stopMetrics()
      stopClaudeUsage()
      offSettings()
    }
  }, [load])

  return (
    <div className={clsx('app', appTheme !== 'dark' && `theme-${appTheme}`)}>
      <TitleBar />
      <main className="workspace-root">
        <Workspace />
      </main>
      <StatusBar />

      <CommandPalette />
      <SettingsModal />
      <TelegramLinkModal />
      <TaskManagerModal />
      <AskAllModal />
      <SnippetFillModal />
      <TemplateSaveModal />
      <SshConnectModal />
      <NotesModal />
      <QuickSwitcher />
      <AgentDoctorModal />
      <RunCommandModal />
      <SessionSearchModal />
      <InsertReferenceModal />
      <McpModal />
      <DelegateModal />
      <WhatsNewModal />
      <SearchBar />
      <ShortcutsModal />
      <ConfirmDialog />
      <Toaster />
      <CopiedFlash />
      <UpdateToast />
      <SelectionTranslate />
    </div>
  )
}
