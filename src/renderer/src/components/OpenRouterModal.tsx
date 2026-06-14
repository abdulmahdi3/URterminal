import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { KeyRound, Check, ArrowRight, ExternalLink, Sparkles } from 'lucide-react'
import { DEFAULT_MODELS } from '@shared/providers'
import { useUi } from '@renderer/store/ui'
import { useSettings } from '@renderer/store/settings'
import { toast } from '@renderer/store/toasts'
import { AgentLogo } from './brandIcons'

const OR_MODELS = DEFAULT_MODELS.openrouter

/**
 * OpenRouter's own configuration home — opened from the launch console's
 * OpenRouter card (not buried in Settings). One key unlocks 200+ models: paste
 * it, pick a model, and make OpenRouter the provider for new panes in one step.
 */
export default function OpenRouterModal(): JSX.Element | null {
  const show = useUi((s) => s.showOpenRouter)
  const setShow = useUi((s) => s.setShowOpenRouter)
  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)

  const keySet = !!settings?.providers.openrouter.keySet
  const keyPreview = settings?.providers.openrouter.keyPreview
  const isDefault = settings?.defaultProvider === 'openrouter'

  const [keyInput, setKeyInput] = useState('')
  const [model, setModel] = useState('')

  // Seed the model field on open: the saved one if OpenRouter is already the
  // provider, otherwise the recommended default.
  useEffect(() => {
    if (show) {
      setKeyInput('')
      setModel((isDefault && settings?.defaultModel) || OR_MODELS[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  // Close on Escape.
  useEffect(() => {
    if (!show) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setShow(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, setShow])

  if (!show) return null

  const saveKey = (): void => {
    const k = keyInput.trim()
    if (!k) return
    void patch({ providerKey: { provider: 'openrouter', key: k } })
    setKeyInput('')
    toast('OpenRouter key saved', 'ok')
  }
  const clearKey = (): void => {
    void patch({ providerKey: { provider: 'openrouter', key: null } })
    toast('OpenRouter key cleared', 'info')
  }
  const useOpenRouter = (): void => {
    void patch({ defaultProvider: 'openrouter', defaultModel: model.trim() || OR_MODELS[0] })
    toast('OpenRouter is now your provider', 'ok')
    setShow(false)
  }

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal or-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="or-head">
          <span className="or-logo">
            <AgentLogo command="openrouter" size={22} />
          </span>
          <div className="or-head-text">
            <div className="or-title">OpenRouter</div>
            <div className="or-sub">One key · 200+ models</div>
          </div>
          <span className={clsx('or-conn', keySet ? 'on' : 'off')}>
            <span className="or-conn-dot" />
            {keySet ? 'Connected' : 'Not connected'}
          </span>
          <button className="icon-btn or-close" onClick={() => setShow(false)} title="Close">
            ✕
          </button>
        </header>

        <div className="or-body">
          <section className="or-section">
            <div className="or-step">
              <span className="or-step-n">1</span>
              <span className="or-label">API key</span>
            </div>
            <div className="or-key-row">
              <span className="or-key-ico">
                <KeyRound size={14} />
              </span>
              <input
                className="input or-key-input"
                type="password"
                autoFocus
                placeholder={keySet ? `•••• ${keyPreview ?? 'saved'}` : 'sk-or-…'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              />
              <button className="btn primary" onClick={saveKey} disabled={!keyInput.trim()}>
                {keySet ? 'Update' : 'Save'}
              </button>
              {keySet && (
                <button className="btn" onClick={clearKey}>
                  Clear
                </button>
              )}
            </div>
            <div className="or-hint">
              Stored encrypted on this machine, never synced.{' '}
              <button
                className="or-link"
                onClick={() => window.open('https://openrouter.ai/keys', '_blank')}
              >
                Get a key <ExternalLink size={11} />
              </button>
            </div>
          </section>

          <section className={clsx('or-section', !keySet && 'or-disabled')}>
            <div className="or-step">
              <span className="or-step-n">2</span>
              <span className="or-label">Model</span>
            </div>
            <input
              className="input or-model-input"
              spellCheck={false}
              placeholder="anthropic/claude-3.5-sonnet"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <div className="or-chips">
              {OR_MODELS.map((m) => (
                <button
                  key={m}
                  className={clsx('or-chip', model === m && 'active')}
                  onClick={() => setModel(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="or-hint">Any of 200+ models — type any OpenRouter id (vendor/model).</div>
          </section>
        </div>

        <footer className="or-foot">
          <span className="or-foot-note">
            {isDefault ? (
              <>
                <Check size={13} /> OpenRouter is your default provider
              </>
            ) : (
              <>
                <Sparkles size={13} /> Make it the provider for new panes
              </>
            )}
          </span>
          <button className="btn primary or-use" onClick={useOpenRouter} disabled={!keySet}>
            Use OpenRouter <ArrowRight size={14} />
          </button>
        </footer>
      </div>
    </div>
  )
}
