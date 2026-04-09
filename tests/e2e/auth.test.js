import { test, expect } from '@playwright/test'

test.describe('Author Auth', () => {
  test('signup page loads', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByText('Author signup')).toBeVisible()
  })

  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('Author login')).toBeVisible()
  })

  test('forgot password page loads', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.getByText('Reset your password')).toBeVisible()
  })

  test('dashboard redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })
})
