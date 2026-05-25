import type { UrterminalApi } from './index'

declare global {
  interface Window {
    api: UrterminalApi
  }
}

export {}
