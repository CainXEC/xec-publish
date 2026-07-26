import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/unit/**/*.test.js', 'jsdom'],
      ['tests/integration/**/*.test.js', 'jsdom'],
    ],
    // Integration tests import real route modules, whose graphs pull in heavy
    // deps (isomorphic-dompurify → jsdom, eager at module load). On a cold CI
    // runner that one-time load can exceed vitest's 5s default and flake the
    // FIRST test that triggers the import (e.g. verifyPayment). Give the whole
    // suite comfortable headroom — this is import overhead, not slow test logic.
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
