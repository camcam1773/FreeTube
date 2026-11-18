import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const toLines = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n'

/**
 * Settings rows needed for a deterministic, local-API-only run.
 * NeDB stores one `{ _id, value }` document per line.
 */
const DEFAULT_SETTINGS = [
  ['backendPreference', 'local'],
  ['backendFallback', false],
  ['checkForUpdates', false],
  ['enableSearchSuggestions', false],
  ['useSponsorBlock', false],
  ['useDeArrowTitles', false],
  ['useDeArrowThumbnails', false],
  ['fetchSubscriptionsAutomatically', false],
  ['currentLocale', 'en-US'],
  ['landingPage', 'history'],
  ['defaultProfile', 'allChannels'],
]

/**
 * @param {string} dir Electron userData directory
 * @param {object} [options]
 * @param {Array<[string, unknown]>} [options.settings] extra/overriding settings rows
 * @param {Record<string, object[]>} [options.databases] extra NeDB rows by file name
 */
export function seedUserData(dir, { settings = [], databases = {} } = {}) {
  mkdirSync(dir, { recursive: true })

  const overrides = new Map(DEFAULT_SETTINGS)
  for (const [id, value] of settings) {
    overrides.set(id, value)
  }

  const files = {
    'settings.db': toLines([...overrides].map(([_id, value]) => ({ _id, value }))),
    'history.db': '',
    'profiles.db': '',
    'playlists.db': '',
    'search-history.db': '',
    'subscription-cache.db': '',
    ...Object.fromEntries(
      Object.entries(databases).map(([name, rows]) => [name, toLines(rows)]),
    ),
  }

  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents)
  }
}
