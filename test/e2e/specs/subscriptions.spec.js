import { expect, test } from '../fixtures.js'
import { CHANNEL, VIDEO_ONE } from '../fixtures/entities.js'
import { AppPage } from '../pages/app.page.js'

test('subscribes to a channel and lists it under Channels', async ({ window }) => {
  const app = new AppPage(window)
  await app.openFirstVideo()

  await window.getByRole('button', { name: 'Subscribe' }).click()
  await expect(window.getByRole('button', { name: /Subscribed|Unsubscribe/ })).toBeVisible()

  await app.navigateTo('/subscribedchannels')
  await expect(window.getByText(CHANNEL.name)).toBeVisible()
})

test('opens a channel and shows its videos tab', async ({ window }) => {
  const app = new AppPage(window)
  await app.openFirstVideo()

  await window.locator('a[href="#/channel/' + CHANNEL.id + '"]').first().click()
  await expect(window).toHaveURL(/#\/channel\//)
  await expect(window.getByText(CHANNEL.name).first()).toBeVisible()
  await expect(window.getByText(VIDEO_ONE.title).first()).toBeVisible()
})
