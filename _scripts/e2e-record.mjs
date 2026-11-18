import { spawnSync } from 'node:child_process'

const result = spawnSync('pnpm', ['exec', 'playwright', 'test'], {
  env: { ...process.env, E2E_RECORD: '1' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(result.status ?? 1)
