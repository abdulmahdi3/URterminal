import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { request } from 'https'
import type { ClaudeUsage } from '@shared/types'

/**
 * Live Claude usage, read straight from Anthropic's OAuth usage endpoint — the
 * exact source Claude Code's own `/usage` command uses. We authenticate with the
 * access token Claude Code already stores in `~/.claude/.credentials.json`, so
 * the numbers match the web/CLI `/usage` view to the percent.
 *
 * (An earlier version reconstructed this from local transcript files; that can't
 * match — the real plan limit, window start, and weighting all live server-side.)
 */

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CREDS = () => join(homedir(), '.claude', '.credentials.json')

interface UsageWindow {
  utilization?: number
  resets_at?: string
}
interface UsageResponse {
  five_hour?: UsageWindow
  seven_day?: UsageWindow
}

// Last good reading — survives transient network blips so the meter doesn't blink.
let lastGood: ClaudeUsage | null = null

async function readToken(): Promise<string | null> {
  try {
    const raw = await readFile(CREDS(), 'utf8')
    const tok = JSON.parse(raw)?.claudeAiOauth?.accessToken
    return typeof tok === 'string' && tok ? tok : null
  } catch {
    return null
  }
}

function fetchUsage(token: string): Promise<UsageResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      USAGE_URL,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'urterminal',
          Accept: 'application/json'
        },
        timeout: 12_000
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body))
            } catch {
              reject(new Error('bad json'))
            }
          } else {
            reject(new Error(`http ${res.statusCode}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end()
  })
}

function toWindow(w: UsageWindow | undefined): { percent: number; resetInMs: number } | null {
  if (!w || typeof w.utilization !== 'number') return null
  const reset = w.resets_at ? Date.parse(w.resets_at) : NaN
  return {
    percent: Math.round(w.utilization),
    resetInMs: Number.isNaN(reset) ? 0 : Math.max(0, reset - Date.now())
  }
}

export async function computeClaudeUsage(): Promise<ClaudeUsage> {
  const token = await readToken()
  if (!token) return lastGood ?? { ok: false, fiveHour: null, sevenDay: null }
  try {
    const data = await fetchUsage(token)
    const usage: ClaudeUsage = {
      ok: true,
      fiveHour: toWindow(data.five_hour),
      sevenDay: toWindow(data.seven_day)
    }
    lastGood = usage
    return usage
  } catch {
    // 401 (token refreshing), offline, etc. — keep the last good reading if any.
    return lastGood ?? { ok: false, fiveHour: null, sevenDay: null }
  }
}
