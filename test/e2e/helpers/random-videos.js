// Fetches real, currently-live YouTube video IDs for the Shaka fuzz spec.
// Nothing here is used by the deterministic (mocked) e2e journey specs.

const SEARCH_QUERIES = [
  'trending',
  'most viewed videos',
  'live stream now',
  '4k 60fps',
  '360 vr experience',
  'orchestra live',
  'viral video',
  'music video 2026',
  'gaming live',
  'space documentary 4k',
]

// Fallback so the fuzz spec still runs if YouTube search is unreachable.
const FALLBACK_IDS = [
  'rz1B4B2yBZY',
  'dQw4w9WgXcQ',
  'aqz-KE-bpKQ',
  'LXb3EKWsInQ',
  '9bZkp7q19f0',
]

// Only match standard `videoRenderer` results. Shorts are exposed through
// different renderers (reelItemRenderer / lockupViewModel), so this excludes
// them without needing a separate duration lookup.
const VIDEO_ID_RE = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/g

/** Shuffle a copy of an array (Fisher-Yates). */
function shuffle(items) {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * Pull video IDs out of YouTube search result pages using a few randomly
 * chosen, deliberately varied queries.
 *
 * @param {number} count
 * @returns {Promise<string[]>}
 */
export async function getRandomVideoIds(count) {
  // Allow pinning IDs (e.g. SHAKA_FUZZ_IDS=id1,id2) to reproduce a specific failure.
  if (process.env.SHAKA_FUZZ_IDS) {
    const pinned = process.env.SHAKA_FUZZ_IDS.split(',')
      .map(id => id.trim())
      .filter(Boolean)
    if (pinned.length) {
      return pinned.slice(0, count)
    }
  }

  /** @type {Set<string>} */
  const ids = new Set()

  for (const query of shuffle(SEARCH_QUERIES).slice(0, 4)) {
    try {
      const response = await fetch(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
      )
      if (!response.ok) {
        continue
      }
      const html = await response.text()
      for (const match of html.matchAll(VIDEO_ID_RE)) {
        ids.add(match[1])
      }
    } catch {
      // Network hiccup - other queries may still succeed.
    }
    if (ids.size >= count * 3) {
      break
    }
  }

  if (ids.size === 0) {
    return shuffle(FALLBACK_IDS).slice(0, count)
  }

  return shuffle([...ids]).slice(0, count)
}
