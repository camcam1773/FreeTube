import { expect, test } from '../fixtures.js'
import { VIDEO_ONE } from '../fixtures/entities.js'
import { AppPage } from '../pages/app.page.js'

const playlistName = 'My E2E Playlist'

test('creates a user playlist and adds the watched video', async ({ window }) => {
  const app = new AppPage(window)
  await app.openFirstVideo()

  await window.getByRole('button', { name: 'Add to Playlist' }).click()
  await window.getByRole('button', { name: 'Create New Playlist' }).click()

  const createPrompt = window.getByRole('dialog', { name: 'New Playlist Name' })
  await createPrompt.getByRole('textbox', { name: 'Playlist Name' }).fill(playlistName)
  await createPrompt.getByRole('button', { name: 'Create' }).click()

  await window.getByRole('button', { name: 'Save' }).click()

  await app.navigateTo('/userplaylists')
  await expect(window.getByText(playlistName)).toBeVisible()

  await window.getByText(playlistName).first().click()
  await expect(window).toHaveURL(/#\/playlist\//)
  await expect(window.getByText(VIDEO_ONE.title).first()).toBeVisible()
})
