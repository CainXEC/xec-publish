import { existsSync } from 'fs'
import { resolve } from 'path'
import dotenv from 'dotenv'
import { defineConfig } from '@playwright/test'

const root = process.cwd()

// Playwright merges `process.env` into the webServer child. The test runner does not load
// `.env.local` automatically — load it here so `next dev` / `next start` see Supabase keys.
dotenv.config({ path: resolve(root, '.env.local') })
if (existsSync(resolve(root, '.env.test.local'))) {
  dotenv.config({ path: resolve(root, '.env.test.local'), override: true })
}

const SUPABASE_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

/** Explicit pass-through so keys are always strings on the child (and visible in one place). */
function supabaseEnvForWebServer() {
  const out = {}
  for (const key of SUPABASE_ENV_KEYS) {
    const v = process.env[key]
    if (typeof v === 'string' && v.length > 0) {
      out[key] = v
    }
  }
  return out
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: process.env.CI ? 'npm run start' : 'npm run dev',
        url: 'http://localhost:3000',
        cwd: root,
        reuseExistingServer: false,
        // Merged by Playwright as: defaults + process.env + this object (this wins on conflicts)
        env: supabaseEnvForWebServer(),
      },
})
