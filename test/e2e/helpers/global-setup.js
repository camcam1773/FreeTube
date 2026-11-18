import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The Electron suite launches the webpack-built app, so make sure it exists.
 * A rebuild is only forced when dist/main.js is missing; CI builds via pnpm pack too.
 */
export default async function globalSetup() {
  if (existsSync(resolve('dist/main.js'))) {
    return
  }

  const result = spawnSync('pnpm', ['run', 'pack'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    throw new Error('`pnpm run pack` failed; cannot run Electron e2e tests')
  }
}
