import { test, expect } from '@playwright/test'

test.describe('Payment flow shell', () => {
  test('unknown slug returns Next.js 404', async ({ page }) => {
    const response = await page.goto('/posts/this-post-does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page).toHaveURL(/\/posts\/this-post-does-not-exist/)
    await expect(
      page.getByText(/This page could not be found/i),
    ).toBeVisible()
  })
})
