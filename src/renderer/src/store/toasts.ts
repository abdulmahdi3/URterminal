import { create } from 'zustand'

export type ToastKind = 'info' | 'ok' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  text: string
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, kind?: ToastKind) => void
  dismiss: (id: string) => void
}

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, kind = 'info') => {
    const id = uid()
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    window.setTimeout(() => get().dismiss(id), 2600)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** Convenience for non-component callers (commands, lib code). */
export const toast = (text: string, kind?: ToastKind): void => useToasts.getState().push(text, kind)
