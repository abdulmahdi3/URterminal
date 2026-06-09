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
export type WhatsNewDemo = 'tour' | 'follow' | 'loader' | 'switch' | 'budget'

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
