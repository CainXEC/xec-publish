/**
 * CI (GitHub Actions): for Playwright e2e, define secrets under
 * Settings → Secrets and variables → Actions (repository secrets).
 *
 * At minimum, add SUPABASE_SERVICE_ROLE_KEY so the Next.js server started by
 * `webServer` can call Supabase from API routes and server loaders. Without it,
 * requests fail with "Invalid API key" and tests break.
 *
 * Also set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the same
 * place (or via your workflow `env:`) if they are not already available to the job.
 */
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
        env: {
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      },
})
