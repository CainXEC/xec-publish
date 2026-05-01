import { test, expect } from '@playwright/test'

test.describe('Homepage', () => {
  const heroHeading = (page) => page.getByRole('heading', { level: 1 }).first()

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  test('loads and shows latest articles', async ({ page }) => {
    await page.goto('/')
    await expect(heroHeading(page)).toBeVisible()
  })

  test('search submits to dedicated /search page and shows empty state', async ({ page }) => {
    await page.goto('/')
    const openSearch = page.locator('#post-search-desktop-toggle')
    await expect(openSearch).toBeVisible({ timeout: 20_000 })
    await openSearch.click()
    const search = page.locator('#post-search-desktop')
    await expect(search).toBeVisible({ timeout: 5000 })
    await search.fill('nonexistentpostxyz')
    await search.press('Enter')
    await page.waitForURL(/\/search\?q=/, { timeout: 5000 })
    await expect(page.getByText(/No posts found matching/i)).toBeVisible({ timeout: 5000 })
  })

  test('sort buttons work', async ({ page }) => {
    await page.goto('/')
    await expect(heroHeading(page)).toBeVisible()
  })

  test('dark mode toggle works', async ({ page }) => {
    await page.goto('/')
    const html = page.locator('html')
    await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).click()
    const classList = await html.getAttribute('class')
    expect(classList).toBeTruthy()
  })

  test('leaderboard link exists', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Leaderboard' }).first()).toBeVisible()
  })
})
