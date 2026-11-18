import { expect, test } from '../fixtures.js'

const LIVE_VIDEO_URL = 'https://youtu.be/rz1B4B2yBZY'
const LIVE_VIDEO_ID = 'rz1B4B2yBZY'
const MIN_PLAYBACK_SECONDS = 5
const IS_CI = Boolean(
  process.env.CI ||
  process.env.GITHUB_ACTIONS ||
  process.env.GITHUB_WORKFLOW,
)

const resolutionOf = (label) => Number(label.match(/(\d+)p/)?.[1] ?? 0)

/** Shaka rebuilds its controls when the live stream reloads, so retry opening the menu. */
async function openResolutionMenu(window) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const moreSettings = window.getByRole('button', { name: 'More settings' })
    if (await moreSettings.isVisible().catch(() => false)) {
      await moreSettings.click({ timeout: 5_000 }).catch(() => {})
    }

    const button = window.locator('.shaka-resolution-button:visible').first()
    if (await button.count()) {
      const status = await button.getAttribute('shaka-status')
      const currentResolution = resolutionOf(status ?? (await button.innerText()))
      try {
        await button.click({ timeout: 5_000 })
        const options = window.locator('.shaka-resolutions .explicit-resolution:visible')
        if (await options.count()) {
          return { options, currentResolution, currentIsAuto: /auto/i.test(status ?? '') }
        }
      } catch {
        // The controls were rebuilt between locating and clicking.
      }
    }

    await window.waitForTimeout(500)
  }

  throw new Error('Could not open Shaka resolution menu')
}

// Live YouTube needs real network + botguard, so this journey is local-only.
test.describe('real video playback (local only)', () => {
  // Live network can transiently fail (throttling, poToken, segment fetch).
  test.describe.configure({ retries: 2, timeout: 180_000 })
  test.skip(IS_CI, 'Live YouTube playback is intentionally skipped in CI')

  test('plays the shared URL for 5s, then increases video quality', async ({ liveWindow }) => {
    const searchBox = liveWindow.getByTestId('search-bar').locator('input')
    await searchBox.fill(LIVE_VIDEO_URL)
    await searchBox.press('Enter')

    await expect(liveWindow).toHaveURL(new RegExp(`#/watch/${LIVE_VIDEO_ID}`))

    const title = liveWindow.locator('h1.videoTitle')
    await expect(title).toBeVisible({ timeout: 60_000 })
    await expect(title).not.toHaveText('')

    // Wait for the real player to finish loading before pressing play.
    await expect(liveWindow.locator('.videoLayout')).not.toHaveClass(/isLoading/, {
      timeout: 60_000,
    })
    const video = liveWindow.locator('video.player')
    await expect(video).toBeVisible({ timeout: 60_000 })
    await expect
      .poll(() => video.evaluate((element) => element.readyState), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(2)

    const playButton = liveWindow.getByRole('button', { name: 'Play (k)' })
    await playButton.click()

    // Retry the play click if the first one landed during a player reload.
    await expect
      .poll(async () => {
        const state = await video.evaluate((element) => ({
          time: element.currentTime,
          paused: element.paused,
        }))
        if (state.time > 0) {
          return true
        }
        if (state.paused) {
          await playButton.click().catch(() => {})
        }
        return false
      }, { timeout: 90_000, intervals: [1000, 2000, 3000] })
      .toBe(true)

    // Assert real playback progress, not just that a video element exists.
    await expect
      .poll(() => video.evaluate((element) => element.currentTime), {
        timeout: 60_000,
        intervals: [1000, 2000, 3000],
      })
      .toBeGreaterThanOrEqual(MIN_PLAYBACK_SECONDS)

    // Open Shaka's settings -> Resolution and pick the next higher quality.
    const { options, currentResolution, currentIsAuto } = await openResolutionMenu(liveWindow)
    const labels = await options.allInnerTexts()
    const choices = labels
      .map((label, optionIndex) => ({ label, optionIndex, resolution: resolutionOf(label) }))
      .filter((option) => option.resolution > 0)
    // When ABR is in Auto, pin an explicit high resolution to guarantee an increase.
    let higher
    if (currentIsAuto) {
      higher = choices.sort((a, b) => b.resolution - a.resolution)
    } else {
      higher = choices.filter((option) => option.resolution > currentResolution)
        .sort((a, b) => a.resolution - b.resolution)
    }

    expect(higher.length, `no quality above ${currentResolution}p in ${labels.join(', ')}`).toBeGreaterThan(0)
    const target = higher[0]

    await options.nth(target.optionIndex).click()

    await expect
      .poll(() => liveWindow.locator('.shaka-resolution-button').first().getAttribute('shaka-status'), {
        timeout: 30_000,
      })
      .toBe(`${target.resolution}p`)
  })
})
