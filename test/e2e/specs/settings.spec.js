import { expect, test } from '../fixtures.js'

test('changes the default landing page in settings', async ({ window }) => {
  await window.locator('.sideNav a[href="#/settings"]:visible').first().click()
  await expect(window).toHaveURL(/#\/settings$/)

  const landingPageSelect = window
    .locator('.select[data-settings-search-label="Default Landing Page"] select')
  await expect(landingPageSelect).toHaveValue('history')

  await landingPageSelect.selectOption('subscriptions')
  await expect(landingPageSelect).toHaveValue('subscriptions')

  // The header logo always points at the currently configured landing page.
  await expect(window.locator('.topNav a.logo')).toHaveAttribute('href', '#/subscriptions')
})
