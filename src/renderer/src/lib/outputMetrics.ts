// Live terminal-output metrics consumed by the metrics store / status bar.
// Fed by agent + shell terminal output (see terminalPool) to drive the live
// TOK/S pill (≈ characters / 4).

let charCount = 0

export function noteOutputChars(n: number): void {
  charCount += n
}

/** Characters streamed since the last read (resets the counter). */
export function takeCharCount(): number {
  const n = charCount
  charCount = 0
  return n
}
