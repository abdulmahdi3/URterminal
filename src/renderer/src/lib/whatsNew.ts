/**
 * Per-release "What's new" content shown as a stepped tour on the first launch
 * after an update (see WhatsNewModal + useWhatsNew).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO UPDATE EACH RELEASE
 * When you cut a new version, add ONE entry keyed by the exact version string in
 * `package.json` (e.g. '0.3.13'). Give it a short headline and 1–5 steps:
 *   • For a feature release  → kind: 'feature', each step a thing users can now do.
 *   • For a bug-fix release  → kind: 'fix',     each step the error that's fixed.
 *   • For a mix              → kind: 'mixed',   tag each step with its own kind.
 * Keep copy user-facing ("Panes now follow live output"), not code-facing.
 * That's the only file you touch — the tour auto-shows once per new version.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Built-in animated illustrations shown when a step has no recorded `media`. */
export type WhatsNewDemo =
  | 'tour'
  | 'follow'
  | 'loader'
  | 'switch'
  | 'budget'
  | 'doctor'
  | 'git'
  | 'drop'
  | 'notif'
  | 'runall'
  | 'jump'
  | 'digest'
  | 'studio'
  | 'minimap'
  | 'zoom'
  | 'export'
  | 'learn'
  | 'recall'

/** One screen of the tour. */
export interface WhatsNewStep {
  title: string
  body: string
  /** override the auto-picked icon (feature → sparkles, fix → wrench). */
  kind?: 'feature' | 'fix'
  /** a recorded preview (gif/png) shown above the text. Import the asset and
   *  pass it here, e.g. `import demo from '../assets/whatsnew/follow.gif'`. */
  media?: string
  /** a built-in animated preview, used when `media` isn't supplied. */
  demo?: WhatsNewDemo
}

/** All notes for a single released version. */
export interface ReleaseNotes {
  version: string
  /** one-line summary shown under the title */
  headline: string
  /** overall nature of the release — drives the header label + default icons */
  kind: 'feature' | 'fix' | 'mixed'
  steps: WhatsNewStep[]
}

/**
 * Changelog keyed by version. Newest first by convention (order here doesn't
 * matter for lookup, only for `latestNotes`).
 */
export const RELEASE_NOTES: Record<string, ReleaseNotes> = {
  '0.3.22': {
    version: '0.3.22',
    headline: 'New in this update',
    kind: 'feature',
    steps: [
      {
        kind: 'feature',
        title: 'OpenRouter: one key, 200+ models',
        demo: 'learn',
        body:
          'Settings → Learning now has OpenRouter as an AI provider. Paste one key and the learning ' +
          'distiller + prompt enhancer can use any of 200+ models (just type the id, e.g. ' +
          'anthropic/claude-3.5-sonnet) — no separate accounts per model.'
      }
    ]
  },

  '0.3.21': {
    version: '0.3.21',
    headline: 'New in this update',
    kind: 'feature',
    steps: [
      {
        kind: 'feature',
        title: 'A profile & persona for every agent',
        demo: 'learn',
        body:
          'Settings → Learning now has two boxes: “About you” (durable facts — your stack, tools, ' +
          'style) and a “Persona” (how agents should behave). With learning on, both are injected ' +
          'into every agent you launch, so they all start knowing you — no re-explaining.'
      }
    ]
  },

  '0.3.20': {
    version: '0.3.20',
    headline: 'New in this update',
    kind: 'feature',
    steps: [
      {
        kind: 'feature',
        title: 'Search your past conversations',
        demo: 'recall',
        body:
          'Press Ctrl+Shift+F to full-text search every chat you’ve ever had with an agent — by ' +
          'anything that was said. Pick a result and it resumes that exact conversation in a new ' +
          'pane. Your whole history, instantly recallable.'
      }
    ]
  },

  '0.3.19': {
    version: '0.3.19',
    headline: 'New in this update',
    kind: 'feature',
    steps: [
      {
        kind: 'feature',
        title: 'Learning runs itself',
        demo: 'learn',
        body:
          'Flip the new “Automatic” switch in Settings → Learning and URterminal records, distils, ' +
          'and feeds memory back to your agents on its own — no more manual “distill” clicks or ' +
          'approving every learning by hand.'
      },
      {
        kind: 'feature',
        title: 'See what it knows about you',
        demo: 'learn',
        body:
          'A new “What URterminal has learned about you” view in Settings → Learning shows every ' +
          'memory and skill it has distilled, so the learning is transparent — nothing hidden.'
      }
    ]
  },

  '0.3.18': {
    version: '0.3.18',
    headline: 'New in this update',
    kind: 'fix',
    steps: [
      {
        kind: 'fix',
        title: 'See every update you missed',
        demo: 'tour',
        body:
          'After updating across several versions at once, What’s New now walks you through all of ' +
          'them — each step tagged with its version — instead of only the latest. You can also open ' +
          'the full changelog any time from Ctrl+K → “What’s new”.'
      }
    ]
  },

  '0.3.17': {
    version: '0.3.17',
    headline: 'New in this update',
    kind: 'feature',
    steps: [
      {
        kind: 'feature',
        title: 'Zoom the whole app',
        demo: 'zoom',
        body:
          'Press Ctrl + and Ctrl − to scale the entire interface up or down, and Ctrl 0 to reset. ' +
          'Great for high-DPI screens or sharing your screen — terminals re-fit automatically and ' +
          'the zoom is remembered.'
      },
      {
        kind: 'feature',
        title: 'Export a pane',
        demo: 'export',
        body:
          'Ctrl+K → “Export this pane as HTML” saves the whole conversation as a styled, shareable ' +
          'HTML file (colors and all), or export plain text — a clean record of a session for a ' +
          'ticket or a teammate.'
      }
    ]
  },

  '0.3.16': {
    version: '0.3.16',
    headline: 'New in this update',
    kind: 'feature',
    steps: [
      {
        kind: 'feature',
        title: 'Prompt minimap',
        demo: 'minimap',
        body:
          'Every prompt you send an agent shows as a tick down the pane’s right edge. Hover the ' +
          'gutter to read the full prompts, and click any one to jump to it in the conversation. ' +
          'Your prompts are remembered per chat, so the map comes back when you restore a session ' +
          'or reopen a chat.'
      }
    ]
  },

  '0.3.15': {
    version: '0.3.15',
    headline: 'New in this update',
    kind: 'feature',
    steps: [
      {
        kind: 'feature',
        title: 'A notification center',
        demo: 'notif',
        body:
          'A new bell in the status bar collects everything in one place — agents finishing their ' +
          'turn, available updates, and alerts — with an unread badge. Open it to catch up, then ' +
          'clear the lot.'
      },
      {
        kind: 'feature',
        title: 'Run a command in every shell',
        demo: 'runall',
        body:
          'Ctrl+K → “Run a command in all shells” fires one command (git pull, npm test, …) into ' +
          'every shell pane in the workspace at once — handy when you’re juggling a row of repos.'
      },
      {
        kind: 'feature',
        title: 'Jump between your prompts',
        demo: 'jump',
        body:
          'Every command you submit drops an invisible bookmark. Press Alt+↑ / Alt+↓ to hop back ' +
          'and forth between turns in long scrollback — no more scroll-wheel hunting for that ' +
          'earlier command.'
      },
      {
        kind: 'feature',
        title: 'Recap a session',
        demo: 'digest',
        body:
          'Ctrl+K → “Summarize this session” drops a clean recap of everything you’ve asked this ' +
          'session straight into the prompt — typed in full (no “[Pasted text]” placeholder) so ' +
          'you can review and send, or feed it to another agent. Offline, no API key.'
      },
      {
        kind: 'feature',
        title: 'Make your own theme',
        demo: 'studio',
        body:
          'Settings → Appearance → Theme → “Custom…” opens a theme studio: pick a background, text, ' +
          'and accent colour and the whole palette — app and terminals — is derived to match. ' +
          'Export or import a theme as JSON to share it.'
      }
    ]
  },

  // 0.3.14 — batch 2 (only THIS version's new features live here, per the
  // "show new features only" rule; older versions keep their own entries).
  '0.3.14': {
    version: '0.3.14',
    headline: 'New in this update',
    kind: 'feature',
    steps: [
      {
        kind: 'feature',
        title: 'Agent doctor: one-click setup',
        demo: 'doctor',
        body:
          'A new setup checklist shows which agent CLIs (Claude, Codex, Gemini, …) are installed, ' +
          'and installs any that are missing with one click — you’re notified when it’s done (and ' +
          'offered a relaunch if needed). It greets new users automatically and lives under ' +
          'Ctrl+K → “Check agent setup”.'
      },
      {
        kind: 'feature',
        title: 'Git status in the status bar',
        demo: 'git',
        body:
          'The status bar now shows the active pane folder’s git branch, how many files have ' +
          'changed, and whether you’re ahead/behind the remote — so you always know the state ' +
          'of the repo you’re working in.'
      },
      {
        kind: 'feature',
        title: 'Drag files in to paste their path',
        demo: 'drop',
        body:
          'Drop one or more files or folders onto any terminal and their full paths are inserted ' +
          'at the prompt — quoted automatically when they contain spaces. No more typing long ' +
          'paths or hunting for them.'
      }
    ]
  },

  '0.3.13': {
    version: '0.3.13',
    headline: "A quick tour of what changed in this update",
    kind: 'mixed',
    steps: [
      {
        kind: 'feature',
        title: "What's new, every update",
        demo: 'tour',
        body:
          'From now on, the first time you open URterminal after an update you’ll get a short ' +
          'tour like this one — new features as steps, or a plain list of what was fixed. ' +
          'You can reopen it any time from the command palette (Ctrl+K → “What’s new”).'
      },
      {
        kind: 'fix',
        title: 'Panes stay glued to live output',
        demo: 'follow',
        body:
          'While an agent like Claude is working, the view no longer freezes above the fold — ' +
          'it keeps following the newest output until you deliberately scroll up to read.'
      },
      {
        kind: 'feature',
        title: 'A loader for every shell',
        demo: 'loader',
        body:
          'Opening a shell now shows a startup loader, not just SSH. Launching a WSL distro like ' +
          'Kali reads “Starting Kali Linux…” until it’s ready.'
      },
      {
        kind: 'feature',
        title: 'Jump to any pane with Ctrl+P',
        demo: 'switch',
        body:
          'Press Ctrl+P to fuzzy-search every pane across all your workspaces — by name, agent, ' +
          'shell, or folder — and jump straight to it. It switches workspace for you if the pane ' +
          'lives in another one.'
      },
      {
        kind: 'feature',
        title: 'Set a session token budget',
        demo: 'budget',
        body:
          'Set a token budget in Settings → Behavior and a meter appears in the status bar. ' +
          'You get a heads-up at 80% and again at 100% so a long multi-agent session never ' +
          'quietly runs up cost.'
      }
    ]
  }
}

/** Notes for an exact version, or undefined when there's nothing authored. */
export function notesFor(version: string): ReleaseNotes | undefined {
  return RELEASE_NOTES[version]
}

/**
 * Which release notes to show on launch, oldest → newest:
 *  • Returning user (has seen `lastSeen`) updating to `current`: EVERY authored
 *    version in the half-open range (lastSeen, current] — so jumping 0.3.14 →
 *    0.3.17 surfaces 0.3.15, 0.3.16 and 0.3.17 together.
 *  • First install (no `lastSeen`): only the latest update's notes (≤ current),
 *    so a brand-new user isn't shown the whole back-catalogue.
 * Returns [] when there's nothing new to show.
 */
export function notesSince(
  lastSeen: string,
  current: string,
  firstRunShowsAll = false
): ReleaseNotes[] {
  const all = Object.values(RELEASE_NOTES)
  const byVer = (a: ReleaseNotes, b: ReleaseNotes): number => compareVersions(a.version, b.version)
  const upTo = (n: ReleaseNotes): boolean => !current || compareVersions(n.version, current) <= 0

  if (!lastSeen) {
    const eligible = all.filter(upTo).sort(byVer)
    // Returning user upgrading from a pre-tour version (no recorded lastSeen):
    // show EVERY authored version up to the current one, not just the latest.
    if (firstRunShowsAll) return eligible
    const latest = (eligible.length ? eligible : all.sort(byVer)).at(-1)
    return latest ? [latest] : []
  }

  return all.filter((n) => compareVersions(n.version, lastSeen) > 0 && upTo(n)).sort(byVer)
}

/** Every authored release's notes, oldest → newest (the full changelog). */
export function allNotes(): ReleaseNotes[] {
  return Object.values(RELEASE_NOTES).sort((a, b) => compareVersions(a.version, b.version))
}

/** The highest-versioned notes available (for the manual "What's new" command). */
export function latestNotes(): ReleaseNotes | undefined {
  const versions = Object.keys(RELEASE_NOTES)
  if (!versions.length) return undefined
  versions.sort(compareVersions)
  return RELEASE_NOTES[versions[versions.length - 1]]
}

/** Numeric semver-ish compare ("0.3.9" < "0.3.10"); non-numeric parts ignored. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
