/** Minimal shape shared by DOM and React keyboard events. */
interface KeyLike {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Normalize a key event to a shortcut string like "Ctrl+Shift+S", or null if
 * it isn't a bindable combo. A modifier is required so plain typing (and normal
 * terminal input) never becomes a shortcut.
 */
export function eventToCombo(e: KeyLike): string | null {
  const code = e.code
  let key: string | null = null
  let m: RegExpExecArray | null
  if ((m = /^Key([A-Z])$/.exec(code))) key = m[1]
  else if ((m = /^Digit(\d)$/.exec(code))) key = m[1]
  else if (/^F\d{1,2}$/.test(code)) key = code
  else if (code === 'Comma') key = ','
  else if (code === 'Period') key = '.'
  else if (code === 'Slash') key = '/'
  else if (code === 'Enter') key = 'Enter'
  else if (code === 'Space') key = 'Space'
  else if (code === 'Backquote') key = '`'
  else return null // lone modifier, arrows, etc. — not bindable

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (parts.length === 0) return null // require at least one modifier
  parts.push(key)
  return parts.join('+')
}
