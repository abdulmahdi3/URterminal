import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { useWorkspace } from './store/workspace'
import { useUi } from './store/ui'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './i18n/i18n'
import './styles/global.css'
import './styles/titlebar.css'
import './styles/workspace.css'
import './styles/sidebar.css'
import './styles/statusbar.css'
import './styles/palette.css'
import './styles/sessions.css'
import './styles/settings.css'
import './styles/notes.css'
import './styles/whatsnew.css'
import './styles/streampane.css'
import './styles/themes.css'
import './styles/launch.css'
import './styles/openrouter.css'
import './styles/ssh.css'

// Debug handles for the scripted smoke harness (see src/main/smoke.ts).
const dbg = window as unknown as {
  __ws: typeof useWorkspace
  __ui: typeof useUi
}
dbg.__ws = useWorkspace
dbg.__ui = useUi

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
