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
  Download,
  Bell,
  Bot,
  DownloadCloud,
  Play,
  Palette,
  Brain,
  User,
  Pin,
  Archive,
  Plug,
  GitFork,
  Send,
  ArrowDown,
  CheckCircle2,
  Server,
  KeyRound,
  Workflow,
  Monitor,
  Laptop,
  Terminal
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
  if (kind === 'ref') {
    // An @-chip expanding into a diff block.
    return (
      <div className="wn-demo wn-demo-ref">
        <div className="wn-ref-chip">@diff</div>
        <div className="wn-ref-arrow">→</div>
        <div className="wn-ref-block">
          <span className="wn-ref-add">+ added line</span>
          <span className="wn-ref-del">- removed line</span>
        </div>
      </div>
    )
  }
  if (kind === 'recall') {
    // A search box over past-conversation result rows.
    return (
      <div className="wn-demo wn-demo-recall">
        <div className="wn-recall-search">
          <Search size={11} /> <span>auth refactor</span>
        </div>
        <div className="wn-recall-rows">
          <div className="wn-recall-row active">JWT migration — 2d ago</div>
          <div className="wn-recall-row">login bug fix — 1w ago</div>
          <div className="wn-recall-row">OAuth setup — 3w ago</div>
        </div>
      </div>
    )
  }
  if (kind === 'profile') {
    // An ID card whose fields fill in.
    return (
      <div className="wn-demo wn-demo-profile">
        <div className="wn-pf-card">
          <div className="wn-pf-avatar">
            <User size={20} />
          </div>
          <div className="wn-pf-lines">
            <span className="wn-pf-line l1" />
            <span className="wn-pf-line l2" />
            <span className="wn-pf-line l3" />
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'curate') {
    // Skill rows: one gets pinned, one archives away.
    return (
      <div className="wn-demo wn-demo-curate">
        <div className="wn-cur-row">
          <span>🛠 git-workflow</span>
          <Pin size={12} className="wn-cur-pin" />
        </div>
        <div className="wn-cur-row wn-cur-archiving">
          <span>🛠 old-helper</span>
          <Archive size={12} />
        </div>
        <div className="wn-cur-row">
          <span>🛠 deploy-steps</span>
          <Pin size={12} className="wn-cur-pin" />
        </div>
      </div>
    )
  }
  if (kind === 'skillget') {
    // A SKILL.md URL dropping into an installed-skill card.
    return (
      <div className="wn-demo wn-demo-skillget">
        <div className="wn-sg-url">…/SKILL.md</div>
        <ArrowDown size={16} className="wn-sg-arrow" />
        <div className="wn-sg-card">
          🛠 skill installed <CheckCircle2 size={12} className="wn-sg-check" />
        </div>
      </div>
    )
  }
  if (kind === 'mcp') {
    // A plug lighting up server chips.
    return (
      <div className="wn-demo wn-demo-mcp">
        <Plug size={22} className="wn-mcp-plug" />
        <div className="wn-mcp-servers">
          <span className="wn-mcp-chip">filesystem</span>
          <span className="wn-mcp-chip">github</span>
          <span className="wn-mcp-chip">postgres</span>
        </div>
      </div>
    )
  }
  if (kind === 'delegate') {
    // One agent forks into a working subagent.
    return (
      <div className="wn-demo wn-demo-delegate">
        <Bot size={24} className="wn-dg-main" />
        <GitFork size={16} className="wn-dg-fork" />
        <div className="wn-dg-sub">
          <Bot size={22} />
          <span className="wn-dg-task">task ▸</span>
        </div>
      </div>
    )
  }
  if (kind === 'webhook') {
    // A message flying from the app to a Discord/Slack chip.
    return (
      <div className="wn-demo wn-demo-webhook">
        <Bot size={22} />
        <Send size={14} className="wn-wh-msg" />
        <div className="wn-wh-targets">
          <span className="wn-wh-chip">Discord</span>
          <span className="wn-wh-chip">Slack</span>
        </div>
      </div>
    )
  }
  if (kind === 'learn') {
    // A brain with orbiting auto-sparkles.
    return (
      <div className="wn-demo wn-demo-learn">
        <Sparkles size={13} className="wn-spark wn-spark-1" />
        <Brain size={30} className="wn-learn-brain" />
        <Sparkles size={11} className="wn-spark wn-spark-2" />
        <Sparkles size={12} className="wn-spark wn-spark-3" />
      </div>
    )
  }
  if (kind === 'zoom') {
    // "Aa" growing/shrinking with zoom key hints.
    return (
      <div className="wn-demo wn-demo-zoom">
        <span className="wn-zoom-aa">Aa</span>
        <div className="wn-zoom-keys">
          <span>Ctrl +</span>
          <span>Ctrl −</span>
          <span>Ctrl 0</span>
        </div>
      </div>
    )
  }
  if (kind === 'export') {
    // A page with a download arrow.
    return (
      <div className="wn-demo wn-demo-export">
        <div className="wn-export-doc">
          <FileText size={26} />
          <span>.html</span>
        </div>
        <Download size={18} className="wn-export-arrow" />
      </div>
    )
  }
  if (kind === 'minimap') {
    // A pane edge with prompt ticks; one highlighted, with a hovered label.
    return (
      <div className="wn-demo wn-demo-minimap">
        <div className="wn-mm-label">refactor the parser →</div>
        <div className="wn-mm-gutter">
          {Array.from({ length: 11 }).map((_, i) => (
            <span key={i} className={'wn-mm-tick' + (i === 6 ? ' active' : '')} />
          ))}
        </div>
      </div>
    )
  }
  if (kind === 'studio') {
    // Three color swatches blending into a themed preview chip.
    return (
      <div className="wn-demo wn-demo-studio">
        <div className="wn-studio-swatches">
          <span className="wn-studio-sw" style={{ background: '#0b0d12' }} />
          <span className="wn-studio-sw" style={{ background: '#e7ecf3' }} />
          <span className="wn-studio-sw wn-studio-pulse" style={{ background: '#bc8cff' }} />
        </div>
        <div className="wn-studio-preview">
          <Palette size={16} /> your theme
        </div>
      </div>
    )
  }
  if (kind === 'digest') {
    // A little markdown summary card being copied.
    return (
      <div className="wn-demo wn-demo-digest">
        <div className="wn-digest-card">
          <div className="wn-digest-h"># session summary</div>
          <div className="wn-digest-l wn-digest-dim">## What you asked (3)</div>
          <div className="wn-digest-l">1. refactor the parser</div>
          <div className="wn-digest-l wn-digest-dim">## Key outputs (2)</div>
          <div className="wn-digest-l">- edited 4 files, tests pass</div>
        </div>
        <div className="wn-digest-copied">
          <FileText size={11} /> copied
        </div>
      </div>
    )
  }
  if (kind === 'jump') {
    // Prompt rows with a marker hopping between them.
    return (
      <div className="wn-demo wn-demo-jump">
        <div className="wn-jump-row">
          <span className="wn-jump-mark" /> <span className="wn-arrow">❯</span> npm run build
        </div>
        <div className="wn-jump-row">
          <span className="wn-jump-mark" /> <span className="wn-arrow">❯</span> git commit -m fix
        </div>
        <div className="wn-jump-row">
          <span className="wn-jump-mark" /> <span className="wn-arrow">❯</span> git push
        </div>
        <div className="wn-jump-keys">
          Alt<span>↑</span> / Alt<span>↓</span>
        </div>
      </div>
    )
  }
  if (kind === 'runall') {
    // One command fanning out to several shells.
    return (
      <div className="wn-demo wn-demo-runall">
        <div className="wn-run-cmd">
          <Play size={11} /> npm&nbsp;test
        </div>
        <div className="wn-run-fan">
          <span className="wn-run-sh">sh 1</span>
          <span className="wn-run-sh">sh 2</span>
          <span className="wn-run-sh">sh 3</span>
        </div>
      </div>
    )
  }
  if (kind === 'notif') {
    // A bell with a badge over a couple of stacked notification rows.
    return (
      <div className="wn-demo wn-demo-notif">
        <div className="wn-notif-bell">
          <Bell size={20} />
          <span className="wn-notif-badge">3</span>
        </div>
        <div className="wn-notif-rows">
          <div className="wn-notif-line">
            <Bot size={11} /> Claude finished
          </div>
          <div className="wn-notif-line">
            <DownloadCloud size={11} /> Update 0.3.15 ready
          </div>
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
  if (kind === 'macro') {
    // A saved sequence firing into the prompt, one line at a time.
    return (
      <div className="wn-demo wn-demo-macro">
        <div className="wn-macro-badge">
          <Play size={11} /> macro
        </div>
        <div className="wn-macro-list">
          <div className="wn-macro-step s1">
            <span className="wn-arrow">❯</span> npm install
          </div>
          <div className="wn-macro-step s2">
            <span className="wn-arrow">❯</span> npm run build
          </div>
          <div className="wn-macro-step s3">
            <span className="wn-arrow">❯</span> npm test
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'localmodels') {
    // A local server lighting up the models you've installed, one by one.
    return (
      <div className="wn-demo wn-demo-localmodels">
        <div className="wn-lm-server">
          <Server size={26} />
          <span className="wn-lm-dot" />
        </div>
        <div className="wn-lm-models">
          <span className="wn-lm-chip c1">llama3.1</span>
          <span className="wn-lm-chip c2">qwen2.5</span>
          <span className="wn-lm-chip c3">mistral</span>
        </div>
      </div>
    )
  }
  if (kind === 'control') {
    // A local curl hitting the loopback control server, which lights up.
    return (
      <div className="wn-demo wn-demo-control">
        <div className="wn-ctl-curl">
          <span className="wn-arrow">$</span> curl :8777/panes
        </div>
        <ArrowDown size={16} className="wn-ctl-arrow" />
        <div className="wn-ctl-server">
          <Server size={16} /> 127.0.0.1 <span className="wn-ctl-dot" />
        </div>
      </div>
    )
  }
  if (kind === 'orchestrate') {
    // A goal fanning out to several worker agents that light up in turn.
    return (
      <div className="wn-demo wn-demo-orchestrate">
        <div className="wn-orch-goal">
          <Workflow size={13} /> goal
        </div>
        <div className="wn-orch-fan">
          <span className="wn-orch-worker w1">
            <Bot size={14} />
          </span>
          <span className="wn-orch-worker w2">
            <Bot size={14} />
          </span>
          <span className="wn-orch-worker w3">
            <Bot size={14} />
          </span>
        </div>
      </div>
    )
  }
  if (kind === 'dashboard') {
    // A loopback browser frame with panes and a live-streaming row.
    return (
      <div className="wn-demo wn-demo-dash">
        <div className="wn-dash-device">
          <div className="wn-dash-bar">
            <span className="wn-dash-dot" /> 127.0.0.1
          </div>
          <div className="wn-dash-row live">
            <Bot size={11} /> claude <span className="wn-dash-stream" />
          </div>
          <div className="wn-dash-row">
            <Terminal size={11} /> shell
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'streamcards') {
    // A turn streaming in: a text card, then a tool card, then a done pill.
    return (
      <div className="wn-demo wn-demo-stream">
        <div className="wn-sc-card c1">
          <Bot size={12} /> Running the tests…
        </div>
        <div className="wn-sc-card c2 tool">
          <Terminal size={12} /> <b>Bash</b> <span className="wn-sc-detail">npm test</span>
        </div>
        <div className="wn-sc-pill c3">
          <Check size={12} /> done · 4.2s
        </div>
      </div>
    )
  }
  if (kind === 'diffreview') {
    // A red/green diff settling as a green "applied" check pulses on.
    return (
      <div className="wn-demo wn-demo-diff">
        <div className="wn-diff-card">
          <div className="wn-diff-line del">- const port = 3000</div>
          <div className="wn-diff-line add">+ const port = 8080</div>
        </div>
        <div className="wn-diff-apply">
          <Check size={16} />
        </div>
      </div>
    )
  }
  if (kind === 'crossplatform') {
    // The same app lighting up on each OS, each tile showing that OS's native shell.
    return (
      <div className="wn-demo wn-demo-xplat">
        <div className="wn-xplat-tile t1">
          <Monitor size={18} />
          <span className="wn-xplat-os">Windows</span>
          <code className="wn-xplat-sh">PS&gt;</code>
        </div>
        <div className="wn-xplat-tile t2">
          <Laptop size={18} />
          <span className="wn-xplat-os">macOS</span>
          <code className="wn-xplat-sh">~ %</code>
        </div>
        <div className="wn-xplat-tile t3">
          <Terminal size={18} />
          <span className="wn-xplat-os">Linux</span>
          <code className="wn-xplat-sh">~ $</code>
        </div>
      </div>
    )
  }
  if (kind === 'launchconsole') {
    // A staggered grid of agent cards, the first one featured (accent ring).
    return (
      <div className="wn-demo wn-demo-launch">
        <div className="wn-lc-hero">
          <span className="wn-lc-logo" />
          <span className="wn-lc-bars">
            <span className="wn-lc-bar b1" />
            <span className="wn-lc-bar b2" />
          </span>
        </div>
        <div className="wn-lc-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className={'wn-lc-card' + (i === 0 ? ' featured' : '')} style={{ ['--d' as string]: `${i * 90}ms` }} />
          ))}
        </div>
      </div>
    )
  }
  if (kind === 'chrome') {
    // A mini window: title bar with tabs + a status bar with chips, gently alive.
    return (
      <div className="wn-demo wn-demo-chrome">
        <div className="wn-cr-title">
          <span className="wn-cr-logo" />
          <span className="wn-cr-tab active">Workspace</span>
          <span className="wn-cr-tab">Workspace 2</span>
          <span className="wn-cr-add">+</span>
        </div>
        <div className="wn-cr-body" />
        <div className="wn-cr-status">
          <span className="wn-cr-chip">
            <span className="wn-cr-dot" /> 2 working
          </span>
          <span className="wn-cr-grow" />
          <span className="wn-cr-chip mono">38%</span>
          <span className="wn-cr-chip mono">1.6M</span>
        </div>
      </div>
    )
  }
  if (kind === 'settings') {
    // A settings card whose toggle slides on, with a nav rail beside it.
    return (
      <div className="wn-demo wn-demo-settings">
        <div className="wn-st-nav">
          <span className="wn-st-navi" />
          <span className="wn-st-navi active" />
          <span className="wn-st-navi" />
        </div>
        <div className="wn-st-cards">
          <div className="wn-st-card">
            <span className="wn-st-ico" />
            <span className="wn-st-lines">
              <span className="wn-st-l1" />
              <span className="wn-st-l2" />
            </span>
            <span className="wn-st-toggle on" />
          </div>
          <div className="wn-st-card">
            <span className="wn-st-ico" />
            <span className="wn-st-lines">
              <span className="wn-st-l1" />
              <span className="wn-st-l2" />
            </span>
            <span className="wn-st-toggle" />
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'palette') {
    // A mini palette: query line, rows, the active row with an accent shortcut.
    return (
      <div className="wn-demo wn-demo-palette">
        <div className="wn-pal-query">
          <Search size={11} /> <span>new shell</span>
          <span className="wn-caret" />
        </div>
        <div className="wn-pal-rows">
          <div className="wn-pal-row active">
            <span className="wn-pal-title">New shell pane</span>
            <span className="wn-pal-kbd">⌃⇧5</span>
          </div>
          <div className="wn-pal-row">
            <span className="wn-pal-title">New agent pane</span>
            <span className="wn-pal-kbd">⌃T</span>
          </div>
          <div className="wn-pal-row">
            <span className="wn-pal-title">Run in all shells</span>
            <span className="wn-pal-kbd dim">set</span>
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'sidebar') {
    // A rail that expands from icons to labelled rows, with an accent active row.
    return (
      <div className="wn-demo wn-demo-sidebar">
        <div className="wn-sb-rail">
          {['', 'active', '', '', ''].map((c, i) => (
            <div key={i} className={'wn-sb-row ' + c}>
              <span className="wn-sb-ico" />
              <span className="wn-sb-lbl" />
            </div>
          ))}
        </div>
        <div className="wn-sb-hint">Ctrl B</div>
      </div>
    )
  }
  if (kind === 'openrouter') {
    // One key on the left routes out to many model chips that light up in turn.
    const models = ['Claude', 'GPT-4o', 'Gemini', 'Llama']
    return (
      <div className="wn-demo wn-demo-or">
        <div className="wn-or-key">
          <KeyRound size={15} />
          <span>1 key</span>
        </div>
        <span className="wn-or-route" />
        <div className="wn-or-models">
          {models.map((m, i) => (
            <span key={m} className="wn-or-model" style={{ ['--d' as string]: `${i * 0.5}s` }}>
              {m}
            </span>
          ))}
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
    // Cap a big catch-up jump (e.g. 0.3.13 → 0.4.6 = dozens of steps) to the most
    // recent ones, so the tour stays digestible and the dot strip never spills
    // out of the panel.
    const MAX_STEPS = 12
    return out.length > MAX_STEPS ? out.slice(out.length - MAX_STEPS) : out
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
  const firstVer = flat[0].version
  const lastVer = flat[flat.length - 1].version
  const multi = firstVer !== lastVer

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
                  What&apos;s new <b>·</b> {firstVer} → {lastVer}
                </>
              ) : (
                <>
                  What&apos;s new <b>·</b> URterminal {firstVer}
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
