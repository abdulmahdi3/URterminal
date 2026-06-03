/**
 * Reliable OS home directory for the renderer. The renderer's `process.env` is
 * not dependable under context isolation, so we fetch the real home dir from the
 * main process once at startup and cache it for synchronous use (e.g. opening an
 * agent in a default folder without a picker).
 */
let cachedHome: string | undefined

export function primeOsInfo(): Promise<void> {
  return window.api
    .getAppInfo()
    .then((i) => {
      if (i.homeDir) cachedHome = i.homeDir
    })
    .catch(() => {})
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
