import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CHANNEL, VIDEOS, VIDEO_ONE, VIDEO_TWO } from '../fixtures/entities.js'
import {
  PLAYER_JS,
  SEARCH_SUGGESTIONS,
  channelBrowseResponse,
  nextResponse,
  playerResponse,
  searchResponse,
  watchHtml,
} from './responses.js'

const RECORDED_DIR = join(process.cwd(), 'test/e2e/fixtures/recorded')
const IS_RECORDING = process.env.E2E_RECORD === '1'
const USE_RECORDED = process.env.E2E_USE_RECORDED === '1'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const videoById = (id) => VIDEOS.find((video) => video.id === id) ?? VIDEO_ONE

function safeKey(value) {
  return String(value ?? 'default').replaceAll(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

function recordedPath(key) {
  return join(RECORDED_DIR, `${key}.json`)
}

function loadRecorded(key) {
  const file = recordedPath(key)
  return USE_RECORDED && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

function stripSensitive(value) {
  if (Array.isArray(value)) {
    return value.map(stripSensitive)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['visitorData', 'apiKey', 'poToken', 'cookie', 'INNERTUBE_API_KEY'].includes(key))
        .map(([key, entry]) => [key, stripSensitive(entry)]),
    )
  }
  if (typeof value === 'string') {
    return value
      .replaceAll(CHANNEL.id, 'UCe2echannel0000000000001')
      .replaceAll(VIDEO_ONE.title, 'First E2E Video')
      .replaceAll(VIDEO_TWO.title, 'Second E2E Video')
  }
  return value
}

async function saveRecorded(key, data) {
  mkdirSync(dirname(recordedPath(key)), { recursive: true })
  writeFileSync(recordedPath(key), JSON.stringify(stripSensitive(data), null, 2))
}

async function jsonResponse(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  })
}

/**
 * Install all network stubs and the poToken stub on the renderer context.
 * No request is allowed to reach the live network except while recording.
 */
export async function installYoutubeMocks(context) {
  await context.route('**/*', async (route) => {
    const request = route.request()
    let url
    try {
      url = new URL(request.url())
    } catch {
      return route.continue()
    }

    const protocol = url.protocol
    const host = url.hostname
    const path = url.pathname

    // Never intercept FreeTube's own bundle.
    if (protocol === 'app:' || protocol === 'file:' || host === 'localhost' || host === '127.0.0.1') {
      return route.continue()
    }

    if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
      if (path === '/watch') {
        const id = url.searchParams.get('videoId') ?? url.searchParams.get('v') ?? VIDEO_ONE.id
        return route.fulfill({ status: 200, contentType: 'text/html', body: watchHtml(videoById(id)) })
      }
      if (path === '/' || path === '/results') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: watchHtml(VIDEO_ONE) })
      }
      if (path.startsWith('/s/player/')) {
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: PLAYER_JS })
      }
      if (path.startsWith('/youtubei/v1/')) {
        return handleYoutubei(route, request, path)
      }
      return route.abort()
    }

    if (host === 'suggestqueries-clients6.youtube.com') {
      const query = url.searchParams.get('q') ?? ''
      return route.fulfill({ status: 200, contentType: 'application/json', body: SEARCH_SUGGESTIONS(query) })
    }

    if (host.endsWith('.googlevideo.com') || host === 'googlevideo.com') {
      return route.fulfill({ status: 200, contentType: 'video/mp2t', body: '' })
    }

    if (host === 'i.ytimg.com' || host.endsWith('.ggpht.com') || host.endsWith('.googleusercontent.com')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG })
    }

    if (host === 'api.github.com') {
      return jsonResponse(route, [])
    }

    // Includes the app's background instance-list fetch, SponsorBlock, DeArrow, etc.
    return route.abort()
  })
}

async function handleYoutubei(route, request, path) {
  let body = {}
  try {
    body = request.postDataJSON() ?? {}
  } catch {
    // Some requests have no JSON body.
  }

  const videoId = body.videoId ?? body?.playerRequest?.videoId ?? VIDEO_ONE.id
  const query = body.query ?? ''
  const endpoint = path.replace('/youtubei/v1/', '')

  let key
  let generated

  switch (endpoint) {
    case 'search':
      key = `search-${safeKey(query)}`
      generated = searchResponse(VIDEOS)
      break
    case 'browse': {
      const browseId = body.browseId ?? CHANNEL.id
      key = `browse-${safeKey(browseId)}-${safeKey(body.params)}`
      generated = channelBrowseResponse(CHANNEL, VIDEOS)
      break
    }
    case 'player':
    case 'get_watch':
      key = `player-${safeKey(videoId)}`
      generated = playerResponse(videoById(videoId))
      break
    case 'next':
      key = `next-${safeKey(videoId)}`
      generated = nextResponse(videoById(videoId))
      break
    case 'navigation/resolve_url':
      key = `resolve-${safeKey(body.url)}`
      generated = {
        endpoint: {
          commandMetadata: { webCommandMetadata: { url: `/channel/${CHANNEL.id}` } },
          browseEndpoint: { browseId: CHANNEL.id },
        },
      }
      break
    default:
      key = `youtubei-${safeKey(endpoint)}`
      generated = {}
  }

  if (IS_RECORDING) {
    const response = await route.fetch()
    const text = await response.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
    await saveRecorded(key, data)
    return route.fulfill({ response, body: text })
  }

  const recorded = loadRecorded(key)
  return jsonResponse(route, recorded ?? generated)
}
