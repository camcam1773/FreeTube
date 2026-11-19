import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { test as base } from '@playwright/test'
import { _electron as electron } from 'playwright'

import { installYoutubeMocks } from './helpers/mock-youtube.js'
import { seedUserData } from './helpers/seed-user-data.js'

function launchArgs(userDataDir) {
  return [
    resolve('dist/main.js'),
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
  ]
}

/**
 * Attach DevTools-style diagnostics to a renderer page.
 *
 * Console errors and uncaught exceptions are always collected into an array on
 * the page object so that specs can assert on them (see the `consoleErrors` and
 * `liveConsoleErrors` fixtures). With `E2E_DEBUG=1` they are also printed to the
 * terminal, alongside a trace of the relevant YouTube requests.
 *
 * @param {import('@playwright/test').Page} page
 */
function attachDiagnostics(page) {
  /** @type {{ type: 'console' | 'pageerror', text: string, at: number }[]} */
  const captured = []
  Object.defineProperty(page, '__capturedErrors', { value: captured })

  const isDebug = process.env.E2E_DEBUG === '1'

  page.on('console', (message) => {
    if (message.type() === 'error') {
      captured.push({ type: 'console', text: message.text(), at: Date.now() })
    }
    if (isDebug) {
      console.warn('[renderer]', message.type(), message.text().slice(0, 400))
    }
  })

  page.on('pageerror', (error) => {
    const text = error.stack ?? error.message
    captured.push({ type: 'pageerror', text, at: Date.now() })
    if (isDebug) {
      console.warn('[pageerror]', text)
    }
  })

  if (isDebug) {
    page.on('request', (request) => {
      if (/(youtubei|watch\?|s\/player\/|suggestqueries)/.test(request.url())) {
        console.warn('[req]', request.method(), request.url().slice(0, 160), request.postData()?.slice(0, 160) ?? '')
      }
    })
  }
}

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'freetube-e2e-'))
    seedUserData(dir)
    await use(dir)
    rmSync(dir, { recursive: true, force: true })
  },

  // Fully mocked app used by the deterministic journey specs.
  electronApp: async ({ userDataDir }, use) => {
    const app = await electron.launch({
      args: launchArgs(userDataDir),
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    })

    // BotGuard runs in a separate Electron session that page.route cannot see.
    // Stub the IPC handler in the main process instead of patching the frozen
    // contextBridge object in the renderer.
    await app.evaluate((electron) => {
      electron.ipcMain.removeHandler('generate-po-token')
      electron.ipcMain.handle('generate-po-token', async () => 'e2e-po-token')
    })

    await use(app)
    await app.close()
  },

  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    attachDiagnostics(page)
    await page.waitForLoadState('domcontentloaded')

    await installYoutubeMocks(page.context())
    await page.reload()
    await page.locator('.app').waitFor({ state: 'visible' })

    await use(page)
  },

  // Real app against live YouTube. No route mocks and no poToken stub.
  liveElectronApp: async ({ userDataDir }, use) => {
    // Start paused so the test can imitate the user pressing play.
    seedUserData(userDataDir, { settings: [['autoplayVideos', false]] })

    const app = await electron.launch({
      args: launchArgs(userDataDir),
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    })

    await use(app)
    await app.close()
  },

  liveWindow: async ({ liveElectronApp }, use) => {
    const page = await liveElectronApp.firstWindow()
    attachDiagnostics(page)
    await page.locator('.app').waitFor({ state: 'visible' })
    await use(page)
  },

  // DevTools-style error log for the mocked app.
  consoleErrors: async ({ window }, use) => {
    await use(window.__capturedErrors)
  },

  // DevTools-style error log for the real app (live YouTube playback).
  liveConsoleErrors: async ({ liveWindow }, use) => {
    await use(liveWindow.__capturedErrors)
  },
})

export { expect } from '@playwright/test'
