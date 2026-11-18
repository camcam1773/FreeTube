import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.js',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Electron is heavy and shares a single app instance per test, so keep it serial.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  globalSetup: './test/e2e/helpers/global-setup.js',
})
