/**
 * Whether this renderer is a SECONDARY window (opened via the jump list or by
 * relaunching the app while it was already running). The main process tags such
 * windows with `?secondary=1`. Secondary windows start with a fresh, empty
 * workspace and never auto-restore or auto-save the last session — doing so
 * would clobber the primary window's persisted workspace and duplicate panes.
 */
export const isSecondaryWindow =
  new URLSearchParams(window.location.search).get('secondary') === '1'
