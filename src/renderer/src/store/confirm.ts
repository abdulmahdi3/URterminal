import { create } from 'zustand'
import type { ReactNode } from 'react'

/** Options for a single confirmation dialog. */
export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' paints the confirm button red (destructive action). */
  tone?: 'danger' | 'default'
}

interface ConfirmState {
  open: boolean
  options: ConfirmOptions | null
  _resolve: ((v: boolean) => void) | null
  /** Open a confirmation dialog; resolves true (confirmed) or false (cancelled). */
  ask: (o: ConfirmOptions) => Promise<boolean>
  /** Close the dialog with the user's choice. */
  respond: (v: boolean) => void
}

/**
 * App-wide confirmation dialog — a themed replacement for window.confirm so we
 * never fall back to the OS's default dialog. Imperative: `confirm({...})`
 * returns a promise that resolves when the user clicks (or presses Enter/Esc).
 */
export const useConfirm = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  _resolve: null,
  ask: (o) =>
    new Promise<boolean>((resolve) => {
      // If a dialog is somehow already open, treat it as cancelled first.
      const prev = get()._resolve
      if (prev) prev(false)
      set({ open: true, options: o, _resolve: resolve })
    }),
  respond: (v) => {
    const r = get()._resolve
    set({ open: false, options: null, _resolve: null })
    if (r) r(v)
  }
}))

/** Convenience for non-component callers (commands, lib code). */
export const confirm = (o: ConfirmOptions): Promise<boolean> => useConfirm.getState().ask(o)
