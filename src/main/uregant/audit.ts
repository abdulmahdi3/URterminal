/**
 * Uregant audit log (UREGANT_PLAN.md §11.4) — the incident-response trail.
 * Durable append-only JSONL under userData; one record per tool decision, with
 * secrets redacted. Best-effort: never throws into the loop.
 */
import { app } from 'electron'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface AuditRecord {
  paneId: string
  tool: string
  args: unknown
  autonomy: string
  /** 'auto' | 'user' | 'denied-by-user' | 'blocked-by-policy' */
  approval: string
  ok: boolean
  detail?: string
}

const SECRET_RE = /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|Bearer\s+[A-Za-z0-9._-]{8,}|-----BEGIN[^-]+PRIVATE KEY-----)/g

function redact(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v).replace(SECRET_RE, '[redacted]'))
  } catch {
    return '[unserializable]'
  }
}

let logPath: string | null = null
function path(): string {
  if (!logPath) logPath = join(app.getPath('userData'), 'uregant-audit.jsonl')
  return logPath
}

export function audit(rec: AuditRecord): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...rec, args: redact(rec.args) }) + '\n'
  void appendFile(path(), line, 'utf8').catch(() => {})
}
