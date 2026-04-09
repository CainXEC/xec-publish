import { test, expect } from '@playwright/test'

test.describe('Payment flow shell', () => {
  test('unknown slug shows not found state', async ({ page }) => {
    await page.goto('/posts/this-post-does-not-exist')
    await expect(page.getByText(/Post not found/i)).toBeVisible()
  })
})
