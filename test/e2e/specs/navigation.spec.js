import { expect, test } from '../fixtures.js'
import { AppPage } from '../pages/app.page.js'

test('opens the app on the configured landing page', async ({ window }) => {
  await expect(window).toHaveURL(/#\/history$/)
  await expect(window.locator('.topNav')).toBeVisible()
  await expect(window.locator('.sideNav')).toBeVisible()
  await expect(window.locator('[role="main"]')).toBeVisible()
})

test('navigates to settings through the side navigation', async ({ window }) => {
  const app = new AppPage(window)
  await app.navigateTo('/settings')
  await expect(window.locator('.settingsPage')).toBeVisible()
})
