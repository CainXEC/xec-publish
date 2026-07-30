import { test, expect } from '@playwright/test'

test.describe('Payment flow shell', () => {
  test('unknown slug renders the not-found page', async ({ page }) => {
    await page.goto('/posts/this-post-does-not-exist')

    // The URL stays put and Next's not-found UI renders in place.
    await expect(page).toHaveURL(/\/posts\/this-post-does-not-exist/)
    await expect(
      page.getByText(/This page could not be found/i),
    ).toBeVisible()

    // Assert that notFound() actually fired (the `next-error` marker Next emits
    // on the not-found boundary) and that the page is noindex'd — NOT the raw
    // HTTP status. Next 16 STREAMS the not-found boundary for dynamically
    // rendered routes (/posts/[slug] is one), flushing a 200 shell before
    // notFound() resolves, so the document status is 200 even though the
    // not-found page rendered. The noindex tag — not the status code — is what
    // keeps a missing URL out of search, so that's the real guarantee to check.
    expect(
      await page.locator('meta[name="next-error"][content="not-found"]').count(),
    ).toBeGreaterThan(0)
    expect(
      await page.locator('meta[name="robots"][content="noindex"]').count(),
    ).toBeGreaterThan(0)
  })
})
