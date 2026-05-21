import type { UregantApi } from './index'

declare global {
  interface Window {
    api: UregantApi
  }
}

export {}
