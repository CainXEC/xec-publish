import { test, expect } from '@playwright/test'

test.describe('Payment flow shell', () => {
  test('unknown slug renders the not-found page', async ({ page }) => {
    await page.goto('/posts/this-post-does-not-exist')

    // The real guarantee: the URL stays put and Next's not-found UI renders —
    // i.e. notFound() fired. We deliberately do NOT assert an HTTP 404 status:
    // Next 16 STREAMS the not-found boundary for dynamically-rendered routes
    // (/posts/[slug] is one), flushing a 200 shell before notFound() resolves,
    // so the document status is 200 even though the not-found page rendered.
    // ("This page could not be found" is Next's built-in 404 copy, stable in
    // both dev and the production build CI runs; the `next-error` meta we tried
    // before is a DEV-ONLY overlay marker and is absent under `next start`.)
    await expect(page).toHaveURL(/\/posts\/this-post-does-not-exist/)
    await expect(
      page.getByText(/This page could not be found/i),
    ).toBeVisible()
  })
})
