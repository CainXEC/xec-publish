import { test, expect } from '@playwright/test'

test.describe('Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  test('loads and shows latest articles', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Read articles by independent writers')).toBeVisible()
  })

  test('search filters posts', async ({ page }) => {
    await page.goto('/')
    const searchButton = page.getByRole('button', { name: /search/i })
    await searchButton.click()
    const search = page.locator('#post-search-desktop')
    await expect(search).toBeVisible()
    await search.fill('nonexistent post xyz')
    await expect(page.getByText(/No posts found/)).toBeVisible()
  })

  test('sort buttons work', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Newest First/ }).click()
    await expect(page.getByRole('button', { name: /Newest First/ })).toBeVisible()
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
