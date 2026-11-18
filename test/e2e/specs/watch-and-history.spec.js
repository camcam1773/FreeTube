import { expect, test } from '../fixtures.js'
import { VIDEO_ONE } from '../fixtures/entities.js'
import { AppPage } from '../pages/app.page.js'

test('opens a search result on the watch page', async ({ window }) => {
  const app = new AppPage(window)
  await app.search('freetube e2e')
  await expect(window.getByText(VIDEO_ONE.title)).toBeVisible()
  await window.getByText(VIDEO_ONE.title).first().click()
  await expect(window).toHaveURL(/#\/watch\/e2e-video-000001/)

  await expect(window.locator('.videoArea h1')).toContainText(VIDEO_ONE.title)
  await expect(window.locator('.ftVideoPlayer')).toBeVisible()
})

test('records a watched video in history', async ({ window }) => {
  const app = new AppPage(window)
  await app.openFirstVideo()

  await app.navigateTo('/history')
  await expect(window.getByText(VIDEO_ONE.title)).toBeVisible()
})
