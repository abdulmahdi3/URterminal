import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Unit tests for the pure / decoupled logic (learning layer, shared helpers).
// Main-process modules that touch Electron mock it per-test (vi.mock('electron')).
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
