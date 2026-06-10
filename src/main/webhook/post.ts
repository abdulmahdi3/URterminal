/**
 * Post a short message to a Discord or Slack incoming webhook. Run from the main
 * process so there's no browser CORS constraint. Best-effort: failures are
 * swallowed (a missed notification must never disrupt the app). The payload shape
 * is detected from the URL host (Slack uses `text`, Discord uses `content`).
 */
export async function postWebhook(url: string, text: string): Promise<void> {
  if (!url || !/^https?:\/\//i.test(url) || !text) return
  const isSlack = /hooks\.slack\.com/i.test(url)
  const msg = text.slice(0, 1800) // Discord caps content at 2000
  const body = isSlack ? { text: msg } : { content: msg }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    })
  } catch {
    /* best-effort */
  }
}
