import { expect, test } from '../fixtures.js'
import { getRandomVideoIds } from '../helpers/random-videos.js'
import { openResolutionMenu } from '../helpers/shaka-controls.js'

const VIDEO_COUNT = Number(process.env.SHAKA_FUZZ_COUNT ?? 8)
// Total wall-clock stress time per video. Sessions/poTokens expire over time, so
// longer playback exercises SABR refresh/reload recovery, not just the first fetch.
const PLAY_SECONDS = Number(process.env.SHAKA_FUZZ_PLAY_SECONDS ?? 12)
// Random seeks force fresh init + segment requests at arbitrary positions.
const SEEK_COUNT = Number(process.env.SHAKA_FUZZ_SEEKS ?? 3)
// Switching resolution rebuilds variants and starts a new request sequence.
const QUALITY_CHANGES = Number(process.env.SHAKA_FUZZ_QUALITY_CHANGES ?? 0)
const SETTLE_MS = Number(process.env.SHAKA_FUZZ_SETTLE_MS ?? 2000)
const MIN_INITIAL_PLAY_SECONDS = 2
const IS_CI = Boolean(
  process.env.CI ||
  process.env.GITHUB_ACTIONS ||
  process.env.GITHUB_WORKFLOW,
)

// logShakaError() in src/renderer/helpers/player/utils.js prefixes every
// unrecoverable Shaka player error with this exact string.
const SHAKA_ERROR_RE = /Player Error \(category and code/

/**
 * Open a video by URL in the search bar and wait for a real player to appear.
 * Throws for videos that are unavailable (age/region restricted, removed, ...)
 * so the fuzz loop can skip them rather than mislabel them as player bugs.
 */
async function openVideo(window, id) {
  const searchBox = window.getByTestId('search-bar').locator('input')
  await searchBox.fill(`https://youtu.be/${id}`)
  await searchBox.press('Enter')

  await expect(window).toHaveURL(new RegExp(`#/watch/${id}`), { timeout: 30_000 })

  const title = window.locator('h1.videoTitle')
  await expect(title).toBeVisible({ timeout: 45_000 })
  await expect(title).not.toHaveText('')

  await expect(window.locator('.videoLayout')).not.toHaveClass(/isLoading/, {
    timeout: 45_000,
  })
  const video = window.locator('video.player')
  await expect(video).toBeVisible({ timeout: 45_000 })
  await expect
    .poll(() => video.evaluate((element) => element.readyState), { timeout: 45_000 })
    .toBeGreaterThanOrEqual(2)

  return video
}

/** Re-click play if the player paused (e.g. after a seek or a reload). */
async function resumeIfPaused(window, video) {
  const paused = await video.evaluate((element) => element.paused)
  if (paused) {
    await window.getByRole('button', { name: 'Play (k)' })
      .click({ timeout: 5_000 })
      .catch(() => {})
  }
}

/** Press play and confirm real playback progress. */
async function startPlayback(window, video) {
  await expect
    .poll(async () => {
      const state = await video.evaluate((element) => ({
        time: element.currentTime,
        paused: element.paused,
      }))
      if (state.time > 0 && !state.paused) {
        return true
      }
      await resumeIfPaused(window, video)
      return false
    }, { timeout: 60_000, intervals: [1000, 2000, 3000] })
    .toBe(true)

  await expect
    .poll(() => video.evaluate((element) => element.currentTime), {
      timeout: 30_000,
      intervals: [1000, 2000, 3000],
    })
    .toBeGreaterThanOrEqual(MIN_INITIAL_PLAY_SECONDS)
}

/** Seek to a random point inside the seekable range, then wait for playback to resume. */
async function randomSeek(window, video) {
  const target = await video.evaluate((element) => {
    const ranges = element.seekable
    let start = 0
    let end = 0
    if (ranges.length) {
      start = ranges.start(0)
      end = ranges.end(ranges.length - 1)
    } else if (Number.isFinite(element.duration)) {
      end = element.duration
    }
    if (!(end > start)) {
      return null
    }
    // Stay away from both edges so there are buffered segments on either side.
    return start + (end - start) * (0.08 + Math.random() * 0.84)
  })
  if (target == null) {
    return
  }

  await video.evaluate((element, time) => {
    element.currentTime = time
  }, target)

  await expect
    .poll(async () => {
      const state = await video.evaluate((element) => ({
        time: element.currentTime,
        paused: element.paused,
        seeking: element.seeking,
      }))
      if (state.seeking || Math.abs(state.time - target) > 10) {
        return false
      }
      if (state.paused) {
        await resumeIfPaused(window, video)
        return false
      }
      return true
    }, { timeout: 30_000, intervals: [500, 1000, 2000] })
    .toBe(true)

  // Let it actually decode/request segments at the new position.
  await window.waitForTimeout(1200)
}

/** Pick a random explicit resolution from Shaka's menu. */
async function changeQuality(window) {
  const { options } = await openResolutionMenu(window)
  const labels = await options.allInnerTexts()
  const choices = labels
    .map((label, index) => ({ index, resolution: Number(label.match(/(\d+)p/)?.[1] ?? 0) }))
    .filter(choice => choice.resolution > 0)
  if (!choices.length) {
    return
  }
  const pick = choices[Math.floor(Math.random() * choices.length)]
  await options.nth(pick.index).click()
  await window.waitForTimeout(1000)
}

/** Apply the configured stress actions for one video. */
async function stressPlayback(window, video) {
  const deadline = Date.now() + PLAY_SECONDS * 1000

  // An action may land while the player is rebuilding after a SABR reload; that
  // is expected during stress, so keep going instead of failing the whole video.
  for (let i = 0; i < SEEK_COUNT && Date.now() < deadline; i++) {
    try {
      await randomSeek(window, video)
    } catch {
      // Player was reloading; try the next seek.
    }
  }
  for (let i = 0; i < QUALITY_CHANGES && Date.now() < deadline; i++) {
    try {
      await changeQuality(window)
    } catch {
      // Controls may be mid-rebuild; the next iteration will retry.
    }
  }

  // Stay on the video for the rest of the budget: long sessions are what expire
  // streaming URLs / poTokens and trigger SABR reload recovery.
  while (Date.now() < deadline) {
    await resumeIfPaused(window, video).catch(() => {})
    await window.waitForTimeout(Math.min(2000, Math.max(0, deadline - Date.now())))
  }
}

test.describe('Shaka player fuzz (local only)', () => {
  test.describe.configure({ mode: 'serial', timeout: 0 })
  test.skip(IS_CI, 'Live YouTube playback is intentionally skipped in CI')

  test(`stress ${VIDEO_COUNT} random YouTube videos without Shaka player errors`, async ({
    liveWindow,
    liveConsoleErrors,
  }) => {
    const ids = await getRandomVideoIds(VIDEO_COUNT)
    console.warn(
      `[fuzz] ${ids.length} videos, ${PLAY_SECONDS}s each, ${SEEK_COUNT} seeks, ${QUALITY_CHANGES} quality changes`,
    )
    console.warn(`[fuzz] IDs: ${ids.join(', ')}`)

    let played = 0
    let skipped = 0
    /** @type {{ id: string, error: string }[]} */
    const shakaErrors = []

    for (const [index, id] of ids.entries()) {
      const errorStart = liveConsoleErrors.length
      console.warn(`[fuzz] (${index + 1}/${ids.length}) ${id}`)

      let video
      try {
        video = await openVideo(liveWindow, id)
      } catch (error) {
        skipped++
        console.warn(`[fuzz] skip ${id} (unavailable): ${String(error).split('\n')[0]}`)
        continue
      }

      try {
        await startPlayback(liveWindow, video)
        await stressPlayback(liveWindow, video)
        played++
      } catch (error) {
        skipped++
        console.warn(`[fuzz] skip ${id} (playback): ${String(error).split('\n')[0]}`)
      }

      // Give segment requests / recovery logic time to surface delayed errors.
      await liveWindow.waitForTimeout(SETTLE_MS)

      const newErrors = liveConsoleErrors.slice(errorStart)
      const playerErrors = newErrors.filter((entry) => SHAKA_ERROR_RE.test(entry.text))
      if (playerErrors.length) {
        shakaErrors.push({
          id,
          error: playerErrors.map((entry) => entry.text).join('\n---\n'),
        })
      }

      const otherErrors = newErrors.filter((entry) => !SHAKA_ERROR_RE.test(entry.text))
      if (otherErrors.length && process.env.E2E_DEBUG === '1') {
        console.warn(`[fuzz] other console errors for ${id}:`, otherErrors.map((e) => e.text).join('\n---\n'))
      }
    }

    console.warn(`[fuzz] played=${played} skipped=${skipped} shakaErrors=${shakaErrors.length}`)
    if (shakaErrors.length) {
      const report = shakaErrors
        .map(({ id, error }) => `Video ${id}:\n${error}`)
        .join('\n\n=====\n\n')
      throw new Error(`Shaka player errors surfaced during random playback:\n\n${report}`)
    }

    expect(played, 'no videos were playable - check network / poToken setup').toBeGreaterThan(0)
  })
})
