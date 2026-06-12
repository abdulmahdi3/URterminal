/**
 * Pure unified-diff parsing + application, shared by the renderer (to detect and
 * preview file edits in an agent's terminal output) and the main process (to
 * apply an approved patch to disk). No Node/DOM dependencies, so it imports
 * cleanly on both sides and is fully unit-testable.
 *
 * Supported input: standard unified diffs (`--- a/x` / `+++ b/x` / `@@`), git's
 * `diff --git` headers, and diffs wrapped in ``` ``` / ```diff fences (the fence
 * lines are ignored). Surrounding prose is skipped — only the regions that look
 * like a diff are picked up.
 */

/** One hunk of a unified diff. `lines` keep their leading ` `/`+`/`-` marker. */
export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** raw hunk body lines, each prefixed with ' ' (context), '+' (add) or '-' (del) */
  lines: string[]
}

/** A parsed patch targeting a single file. */
export interface FilePatch {
  /** target path (the `b/` side), with any `a/`|`b/` prefix stripped */
  file: string
  /** source path (the `a/` side) */
  oldFile: string
  /** `--- /dev/null` — the file is being created */
  isNew: boolean
  /** `+++ /dev/null` — the file is being deleted */
  isDelete: boolean
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

export interface ApplyResult {
  ok: boolean
  result?: string
  error?: string
}

const DEV_NULL = /^\/dev\/null$/

/** Strip a leading `a/` or `b/` (git) and surrounding quotes/whitespace. */
function cleanPath(p: string): string {
  let s = p.trim()
  // git may quote paths with spaces: "b/some file.ts"
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  // drop a trailing tab + timestamp that some `diff` variants append
  s = s.split('\t')[0]
  if (DEV_NULL.test(s)) return '/dev/null'
  return s.replace(/^[ab]\//, '')
}

const HUNK_RE = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Parse every unified-diff patch found in `text`. Returns one FilePatch per file
 * header. Robust to fenced blocks and interleaved prose; tolerant of blank
 * context lines (it consumes exactly the line counts the `@@` header declares).
 */
export function parsePatches(text: string): FilePatch[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const patches: FilePatch[] = []
  let cur: FilePatch | null = null
  let pendingOld: string | null = null // a `--- ` line awaiting its `+++ `

  const push = (): void => {
    if (cur && cur.hunks.length) patches.push(cur)
    cur = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Ignore code-fence markers entirely (```/```diff).
    if (/^```/.test(line)) continue

    // `diff --git a/x b/y` starts a new file; the real paths come from the
    // following ---/+++ lines, so we just close any open patch here.
    if (/^diff --git /.test(line)) {
      push()
      pendingOld = null
      continue
    }

    // `--- a/x` (old file). Remember it; the next `+++ b/y` opens the patch.
    if (line.startsWith('--- ')) {
      push()
      pendingOld = cleanPath(line.slice(4))
      continue
    }

    // `+++ b/y` (new file) — pairs with the pending `---` to open a patch.
    if (line.startsWith('+++ ') && pendingOld !== null) {
      const newPath = cleanPath(line.slice(4))
      const isNew = pendingOld === '/dev/null'
      const isDelete = newPath === '/dev/null'
      cur = {
        file: isDelete ? pendingOld : newPath,
        oldFile: pendingOld,
        isNew,
        isDelete,
        hunks: [],
        additions: 0,
        deletions: 0
      }
      pendingOld = null
      continue
    }

    // A hunk header. Consume exactly oldLines/newLines of body.
    const m = HUNK_RE.exec(line)
    if (m && cur) {
      const oldLines = m[2] === undefined ? 1 : parseInt(m[2], 10)
      const newLines = m[4] === undefined ? 1 : parseInt(m[4], 10)
      const hunk: DiffHunk = {
        oldStart: parseInt(m[1], 10),
        oldLines,
        newStart: parseInt(m[3], 10),
        newLines,
        lines: []
      }
      let seenOld = 0
      let seenNew = 0
      let j = i + 1
      for (; j < lines.length && (seenOld < oldLines || seenNew < newLines); j++) {
        const body = lines[j]
        const c = body[0]
        if (c === '\\') continue // "\ No newline at end of file"
        if (c === '+') {
          hunk.lines.push(body)
          seenNew++
          cur.additions++
        } else if (c === '-') {
          hunk.lines.push(body)
          seenOld++
          cur.deletions++
        } else if (c === ' ' || body === '') {
          // context line (a blank line is a zero-width context line)
          hunk.lines.push(body === '' ? ' ' : body)
          seenOld++
          seenNew++
        } else {
          break // hit prose / a new header before the counts were satisfied
        }
      }
      cur.hunks.push(hunk)
      i = j - 1
      continue
    }
  }
  push()
  return patches
}

/** Split a unified-diff hunk into the lines it expects to find vs. produce. */
function hunkBlocks(h: DiffHunk): { oldBlock: string[]; newBlock: string[] } {
  const oldBlock: string[] = []
  const newBlock: string[] = []
  for (const l of h.lines) {
    const c = l[0]
    const body = l.slice(1)
    if (c === '+') newBlock.push(body)
    else if (c === '-') oldBlock.push(body)
    else {
      oldBlock.push(body)
      newBlock.push(body)
    }
  }
  return { oldBlock, newBlock }
}

/** Does `block` occur in `arr` starting exactly at `at`? */
function matchesAt(arr: string[], block: string[], at: number): boolean {
  if (at < 0 || at + block.length > arr.length) return false
  for (let k = 0; k < block.length; k++) if (arr[k + at] !== block[k]) return false
  return true
}

/**
 * Find where `oldBlock` sits in `arr`, preferring `hint` (the diff's stated line)
 * and spiralling outward so a patch still applies when earlier edits shifted the
 * line numbers. Returns -1 if the context can't be found.
 */
function locate(arr: string[], block: string[], hint: number): number {
  if (block.length === 0) return Math.max(0, Math.min(hint, arr.length))
  if (matchesAt(arr, block, hint)) return hint
  for (let d = 1; d <= arr.length; d++) {
    if (matchesAt(arr, block, hint - d)) return hint - d
    if (matchesAt(arr, block, hint + d)) return hint + d
  }
  return -1
}

/**
 * Apply parsed hunks to `original`, returning the new file content. Tolerates
 * line-number drift by searching for each hunk's context. Fails (ok:false) if a
 * hunk's context can't be located, rather than corrupting the file.
 *
 * The original's trailing-newline state is preserved.
 */
export function applyPatch(original: string, hunks: DiffHunk[]): ApplyResult {
  if (!hunks.length) return { ok: false, error: 'No hunks to apply' }
  const hadTrailingNewline = original.endsWith('\n')
  const normalized = original.replace(/\r\n?/g, '\n')
  // Work on a line array. A trailing newline yields a final '' we drop, then re-add.
  let arr = normalized.length ? normalized.split('\n') : []
  if (hadTrailingNewline && arr.length && arr[arr.length - 1] === '') arr = arr.slice(0, -1)

  let delta = 0
  for (const h of hunks) {
    const { oldBlock, newBlock } = hunkBlocks(h)
    const hint = Math.max(0, h.oldStart - 1 + delta)
    const at = locate(arr, oldBlock, hint)
    if (at < 0) {
      return { ok: false, error: `Could not locate context for hunk @@ -${h.oldStart} (file changed since the diff was generated)` }
    }
    arr = [...arr.slice(0, at), ...newBlock, ...arr.slice(at + oldBlock.length)]
    delta += newBlock.length - oldBlock.length
  }

  let result = arr.join('\n')
  if (hadTrailingNewline && result.length) result += '\n'
  return { ok: true, result }
}

/** Full new-file content from a single add-everything patch (isNew). */
export function newFileContent(patch: FilePatch): string {
  const out: string[] = []
  for (const h of patch.hunks) for (const l of h.lines) if (l[0] === '+') out.push(l.slice(1))
  return out.join('\n') + (out.length ? '\n' : '')
}
