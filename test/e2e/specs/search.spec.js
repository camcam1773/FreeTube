import { expect, test } from '../fixtures.js'
import { VIDEO_ONE, VIDEO_TWO } from '../fixtures/entities.js'
import { AppPage } from '../pages/app.page.js'

test('searches for videos and shows the mocked results', async ({ window }) => {
  const app = new AppPage(window)
  await app.search('freetube e2e')

  await expect(window).toHaveURL(/#\/search\/freetube%20e2e/)
  await expect(window.getByText(VIDEO_ONE.title)).toBeVisible()
  await expect(window.getByText(VIDEO_TWO.title)).toBeVisible()
})

test('searches via the action button', async ({ window }) => {
  const searchBar = window.getByTestId('search-bar')
  await searchBar.locator('input').fill('second video')
  await searchBar.locator('.inputAction').click()

  await expect(window).toHaveURL(/#\/search\/second%20video/)
  await expect(window.getByText(VIDEO_TWO.title)).toBeVisible()
})
