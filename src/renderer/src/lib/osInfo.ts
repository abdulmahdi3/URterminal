/**
 * Reliable OS facts for the renderer. The renderer's `process.env` and
 * `process.platform` aren't dependable under context isolation, so we fetch the
 * real home dir + platform from the main process once at startup and cache them
 * for synchronous use (e.g. opening an agent in a default folder without a
 * picker, or choosing the right built-in shells per OS).
 */
let cachedHome: string | undefined
let cachedPlatform: NodeJS.Platform | undefined

export function primeOsInfo(): Promise<void> {
  return window.api
    .getAppInfo()
    .then((i) => {
      if (i.homeDir) cachedHome = i.homeDir
      if (i.platform) cachedPlatform = i.platform
    })
    .catch(() => {})
}

/** The host OS, resolved from the main process (cached). Best-effort before prime. */
export function platform(): NodeJS.Platform {
  if (cachedPlatform) return cachedPlatform
  // Fallbacks before primeOsInfo resolves: navigator hints, then assume win32
  // (the historical default) so callers never get undefined.
  try {
    const ua = navigator.userAgent
    if (/Mac/i.test(ua)) return 'darwin'
    if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux'
  } catch {
    /* navigator unavailable */
  }
  return 'win32'
}

/** True on macOS — handy for Cmd-vs-Ctrl and traffic-light affordances. */
export function isMac(): boolean {
  return platform() === 'darwin'
}

/** Best-effort home dir: the main-process value, falling back to renderer env. */
export function homeDir(): string | undefined {
  if (cachedHome) return cachedHome
  try {
    const p = process as NodeJS.Process
    return p?.env?.USERPROFILE ?? p?.env?.HOME
  } catch {
    return undefined
  }
}
