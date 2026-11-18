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

function debugPage(page) {
  if (process.env.E2E_DEBUG !== '1') {
    return
  }
  page.on('console', (message) => {
    console.warn('[renderer]', message.type(), message.text().slice(0, 400))
  })
  page.on('request', (request) => {
    if (/(youtubei|watch\?|s\/player\/|suggestqueries)/.test(request.url())) {
      console.warn('[req]', request.method(), request.url().slice(0, 160), request.postData()?.slice(0, 160) ?? '')
    }
  })
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
    debugPage(page)
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
    debugPage(page)
    await page.locator('.app').waitFor({ state: 'visible' })
    await use(page)
  },
})

export { expect } from '@playwright/test'
