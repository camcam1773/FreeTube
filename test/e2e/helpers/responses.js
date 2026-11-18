// Builders for the subset of InnerTube responses FreeTube reads.
// These are intentionally small: enough for the UI to render and navigate.
// When E2E_RECORD=1, real responses can be captured and stored under
// test/e2e/fixtures/recorded/ to override these generated ones.

const text = (value) => ({ simpleText: value })
const runs = (value) => ({ runs: [{ text: value }] })
const thumbnails = (url) => ({ thumbnails: [{ url, width: 480, height: 360 }] })

function videoRenderer(video) {
  return {
    videoId: video.id,
    title: runs(video.title),
    publishedTimeText: text(video.publishedText),
    lengthText: text(video.durationText),
    viewCountText: text(video.viewsText),
    ownerText: {
      runs: [{
        text: video.author,
        navigationEndpoint: { browseEndpoint: { browseId: video.channelId } },
      }],
    },
    thumbnail: thumbnails(`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`),
    navigationEndpoint: { watchEndpoint: { videoId: video.id } },
    thumbnailOverlays: [{
      thumbnailOverlayTimeStatusRenderer: {
        style: 'DEFAULT',
        text: text(video.durationText),
      },
    }],
  }
}

export function searchResponse(videos) {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [{
              itemSectionRenderer: {
                contents: videos.map((video) => ({ videoRenderer: videoRenderer(video) })),
              },
            }],
          },
        },
      },
    },
  }
}

export function channelBrowseResponse(channel, videos) {
  return {
    header: {
      c4TabbedHeaderRenderer: {
        channelId: channel.id,
        title: channel.name,
        navigationEndpoint: { browseEndpoint: { browseId: channel.id } },
        avatar: thumbnails(channel.avatar),
        subscriberCountText: text(channel.subscribers),
      },
    },
    metadata: {
      channelMetadataRenderer: {
        externalId: channel.id,
        title: channel.name,
      },
    },
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            title: 'Videos',
            selected: true,
            endpoint: {
              commandMetadata: { webCommandMetadata: { url: `/channel/${channel.id}/videos` } },
              browseEndpoint: { browseId: channel.id, params: 'EgZ2aWRlb3PyBgQKAjoA' },
            },
            content: {
              richGridRenderer: {
                contents: videos.map((video) => ({ videoRenderer: videoRenderer(video) })),
              },
            },
          },
        }],
      },
    },
  }
}

function format(video) {
  return {
    itag: 18,
    url: `https://e2e.googlevideo.test/videoplayback?id=${video.id}`,
    mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
    bitrate: 500000,
    width: 640,
    height: 360,
    quality: 'medium',
    fps: 30,
    qualityLabel: '360p',
    averageBitrate: 400000,
    audioQuality: 'AUDIO_QUALITY_MEDIUM',
    approxDurationMs: String(video.durationSeconds * 1000),
    contentLength: '1000000',
    projectionType: 'RECTANGULAR',
  }
}

export function playerResponse(video) {
  return {
    playabilityStatus: { status: 'OK' },
    videoDetails: {
      videoId: video.id,
      title: video.title,
      author: video.author,
      channelId: video.channelId,
      lengthSeconds: String(video.durationSeconds),
      viewCount: String(video.views),
      shortDescription: video.description,
      thumbnail: thumbnails(`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`),
      allowRatings: true,
      isPrivate: false,
      isCrawlable: true,
    },
    microformat: {
      playerMicroformatRenderer: {
        title: runs(video.title),
        publishDate: '2026-01-01T00:00:00Z',
        uploadDate: '2026-01-01',
        category: 'Entertainment',
      },
    },
    streamingData: {
      expiresInSeconds: '3600',
      formats: [format(video)],
      adaptiveFormats: [],
    },
  }
}

export function nextResponse(video) {
  return {
    contents: {
      twoColumnWatchNextResults: {
        results: {
          results: {
            contents: [
              {
                videoPrimaryInfoRenderer: {
                  title: runs(video.title),
                  viewCount: {
                    videoViewCountRenderer: { viewCount: text(video.viewsText) },
                  },
                  publishedTimeText: text(video.publishedText),
                },
              },
              {
                videoSecondaryInfoRenderer: {
                  description: runs(video.description),
                  owner: {
                    videoOwnerRenderer: {
                      title: runs(video.author),
                      thumbnail: thumbnails('https://i.ytimg.com/vi/e2e-channel/avatar.jpg'),
                      subscriberCountText: text('12,345 subscribers'),
                      navigationEndpoint: {
                        browseEndpoint: { browseId: video.channelId },
                      },
                    },
                  },
                  metadataRowContainer: {
                    metadataRowContainerRenderer: { rows: [] },
                  },
                },
              },
            ],
          },
        },
        secondaryResults: {
          secondaryResults: { results: [] },
        },
      },
    },
  }
}

const YTCFG = {
  INNERTUBE_CONTEXT: {
    client: {
      clientName: 'WEB',
      clientVersion: '2.20250312.04.00',
      hl: 'en',
      gl: 'US',
      visitorData: 'e2e-visitor-data',
    },
  },
  INNERTUBE_API_KEY: 'e2e-api-key',
  INNERTUBE_API_VERSION: 'v1',
  PLAYER_JS_URL: '/s/player/e2eplayerid/player_es6.vflset/en_US/base.js',
}

/**
 * Watch HTML consumed by getHTMLPage(): it regex-extracts ytcfg, ytAtN,
 * ytInitialPlayerResponse and ytInitialData, so no /player or /next calls
 * are necessary once this page is served.
 */
export function watchHtml(video) {
  return `<!doctype html>
<html><head><title>${video.title}</title></head><body>
<script>ytcfg.set(${JSON.stringify(YTCFG)});</script>
<script>window.ytAtN({TOKEN:"e2e",INTERPRETER_JS_URL:"https://www.youtube.com/s/player/e2eplayerid/attestation/e2e.js"});</script>
<script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse(video))};</script>
<script>var ytInitialData = ${JSON.stringify(nextResponse(video))};</script>
</body></html>`
}

// Minimal stub for youtubei.js' Player.create(). Format URLs above have no
// `n` or signatureCipher, so decipher/eval is never exercised.
export const PLAYER_JS = `
var sigTimestamp = 0;
function decipher() { return ''; }
`

export const SEARCH_SUGGESTIONS = (query) =>
  `window.google.ac.h([["${query}",[["${query} e2e suggestion",0],["${query} another",0]]],[],[]])`
