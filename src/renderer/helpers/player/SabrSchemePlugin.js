import { base64ToU8, concatenateChunks, EventEmitterLike, MAX_INT32_VALUE } from 'googlevideo/utils'
import { CompositeBuffer, UmpReader } from 'googlevideo/ump'
import {
  UMPPartId,
  VideoPlaybackAbrRequest,
  StreamProtectionStatus,
  SabrError,
  SabrRedirect,
  MediaHeader,
  SabrContextSendingPolicy,
  SabrContextUpdate,
  SabrContextWritePolicy,
  NextRequestPolicy,
  PlaybackCookie,
  ReloadPlaybackContext,
} from 'googlevideo/protos'
import shaka from 'shaka-player'

import { deepCopy } from '../utils'

const AbortableOperation = shaka.util.AbortableOperation
const ShakaError = shaka.util.Error

/**
 * @typedef OperationInputs
 * @type {object}
 * @property {string} uri
 * @property {shaka.extern.Request} request
 * @property {shaka.net.NetworkingEngine.RequestType} requestType
 * @property {shaka.extern.HeadersReceived} headersReceived
 * The following are calculated from above properties
 * @property {string} formatIdString
 * @property {boolean} isInit
 * @property {number} sequenceNumber
 */
/**
 * @typedef AbortStatus
 * @type {object}
 * @property {boolean} cancelled
 * @property {boolean} timedOut
 * @property {boolean} playerReloadRequested
 * @property {boolean} finished
 */
/**
 * @typedef CurrentState
 * @type {object}
 * @property {Map<string, Uint8Array>} initDataCache
 * @property {VideoPlaybackAbrRequest} abrRequest
 * @property {RequestInit} requestInit
 * @property {AbortStatus} abortStatus
 * @property {AbortController} abortController
 * @property {SabrStreamState} sabrStreamState
 * @property {?TimeoutController} timeoutController
 * @property {?EventEmitterLike} eventEmitter
 * @property {RefreshPlaybackContext | undefined} refreshPlaybackContext
 * @property {number} cumulativeBackOffTimeMs
 * @property {number} cumulativeBackOffRequested
 * @property {number} cumulativeRetryDueToNextRequestPolicy
 */
/**
 * @typedef SabrStreamState
 * @type {object}
 * @property {string} sabrUrl
 * @property {Uint8Array} poToken
 * @property {Set<number>} activeSabrContextTypes
 * @property {Map<number, SabrContextUpdate>} sabrContexts
 * @property {?NextRequestPolicy} nextRequestPolicy
 * @property {boolean} playerReloadRequested
 * @property {number} requestNumber
 * @property {number} healthyPlaybackTimeMs
 * @property {number} lastHealthyPlaybackAt
 * @property {RefreshBudget} reloadRefreshBudget
 * @property {RefreshBudget} forbiddenRefreshBudget
 * @property {RefreshBudget} sabrErrorRefreshBudget
 * @property {?Promise<?{url: string, ustreamerConfig?: string}>} pendingRefresh
 */
/**
 * @typedef TimeoutController
 * @type {object}
 * @property {() => void} resetTimeoutOnce
 * @property {() => void} clearTimeout
 */
/**
 * @typedef SabrStream
 * @type {object}
 * @property {(cb: ({backoffMs: number}) => void) => void} onBackoffRequested
 * @property {(cb: () => void) => void} onReloadOnce
 * @property {() => void | undefined} cleanup
 */
/**
 * Why the playback session is being refreshed. Each reason spends its own allowance.
 * - `forbidden`: the streamer rejected the request (401/403), so the session likely expired
 * - `reload`: YouTube asked for a reload with `RELOAD_PLAYER_RESPONSE`
 * - `invalidPoToken`: the stream protection status rejected the poToken
 * - `sabrError`: the streamer reported a SABR error part
 * @typedef {'forbidden' | 'reload' | 'invalidPoToken' | 'sabrError'} RefreshReason
 */
/**
 * @typedef RefreshPlaybackOptions
 * @type {object}
 * @property {import('googlevideo/protos').ReloadPlaybackContext} [reloadPlaybackContext]
 *   Set when YouTube requested a reload with `RELOAD_PLAYER_RESPONSE`
 * @property {boolean} [tokenIsInvalid]
 *   Set when the stream protection status rejected the poToken, so a new one must be minted
 */
/**
 * Refreshes the playback session, returning a new SABR URL (and a new poToken when one
 * was minted). Returns `null` when the session cannot be refreshed in place.
 * @typedef RefreshPlaybackContext
 * @type {(options: RefreshPlaybackOptions) => Promise<?{url: string, ustreamerConfig?: string, poToken?: string}>}
 */

/**
 * @typedef RefreshBudget
 * @type {object}
 * @property {number} max
 * @property {number} available
 */

/**
 * Independent allowances for refreshing the playback session in place, so a burst of 403s,
 * a server requested reload, or a video that keeps reporting SABR errors each spend their
 * own credits instead of starving the others.
 * Credits are earned back by healthy playback (see `recordHealthyPlaybackTime`), so a
 * long video doesn't permanently lose the ability to recover in place.
 */
const MAX_RELOAD_REFRESH_CREDITS = 3
const MAX_FORBIDDEN_REFRESH_CREDITS = 2
const MAX_SABR_ERROR_REFRESH_CREDITS = 1
const REFRESH_CREDIT_INTERVAL_MS = 60 * 1000

/**
 * Playback gaps longer than this don't count as healthy playback, so pausing or a
 * stalled download doesn't earn refresh credits.
 */
const MAX_HEALTHY_GAP_MS = 30 * 1000

/**
 * Which allowance each refresh reason spends. Adding a pool means adding a reason and an
 * entry here, rather than another branch at the call site.
 * @type {Record<RefreshReason, 'reloadRefreshBudget' | 'forbiddenRefreshBudget' | 'sabrErrorRefreshBudget'>}
 */
const REFRESH_BUDGET_BY_REASON = {
  forbidden: 'forbiddenRefreshBudget',
  reload: 'reloadRefreshBudget',
  invalidPoToken: 'forbiddenRefreshBudget',
  sabrError: 'sabrErrorRefreshBudget',
}

/**
 * @param {string} str
 */
function formatIdFromString(str) {
  const videoFormatIdParts = str.split('-')

  return {
    itag: parseInt(videoFormatIdParts[0]),
    lastModified: videoFormatIdParts[1],
    xtags: videoFormatIdParts[2]
  }
}

/**
 * @param {import('googlevideo/protos').FormatId} formatId
 * @param {shaka.extern.BufferedRange} buffered
 * @param {shaka.media.SegmentIndex} segmentIndex
 */
function createBufferedRange(formatId, buffered, segmentIndex) {
  let endSegmentIndex = segmentIndex.find(buffered.end)
  if (endSegmentIndex == null) {
    // Using Last end time will get `null` in `segmentIndex.find`
    endSegmentIndex = segmentIndex.getNumReferences() - 1
  }

  return {
    formatId,
    startTimeMs: String(Math.round(buffered.start * 1000)),
    durationMs: String(Math.round((buffered.end - buffered.start) * 1000)),
    startSegmentIndex: segmentIndex.find(buffered.start),
    endSegmentIndex: endSegmentIndex,
  }
}

/**
 * Creates a bogus buffered range for a format. Used when we want to signal to the server to not send any
 * segments for this format.
 * @param {import('googlevideo/protos').FormatId} formatId - The format to create a full buffer range for.
 * @returns {import('googlevideo/protos').BufferedRange} A BufferedRange object indicating the entire format is buffered.
 */
function createFullBufferRange(formatId) {
  return {
    formatId: formatId,
    durationMs: MAX_INT32_VALUE,
    startTimeMs: '0',
    startSegmentIndex: parseInt(MAX_INT32_VALUE),
    endSegmentIndex: parseInt(MAX_INT32_VALUE),
    timeRange: {
      durationTicks: MAX_INT32_VALUE,
      startTicks: '0',
      timescale: 1000
    }
  }
}

/**
 * @param {shaka.Player} player
 * @param {shaka.extern.Manifest} manifest
 * @param {boolean} audioFormatsActive
 * @param {boolean} streamIsVideo - Fake audio bufferRange can be used
 * @param {boolean} streamIsAudio - Fake video bufferRange can be used
 * @param {import('googlevideo/protos').BufferedRange[]} bufferedRanges
 * @param {shaka.extern.Track} activeVariant
 */
function fillBufferedRanges(player, manifest, audioFormatsActive, streamIsVideo, streamIsAudio, bufferedRanges, activeVariant) {
  const bufferedInfo = player.getBufferedInfo()

  if (bufferedInfo.audio.length > 0 || bufferedInfo.video.length > 0) {
    let activeManifestVariant
    if (audioFormatsActive) {
      activeManifestVariant = manifest.variants.find((variant) => {
        return variant.audio.originalId === activeVariant.originalAudioId
      })
    } else {
      activeManifestVariant = manifest.variants.find((variant) => {
        return variant.audio.originalId === activeVariant.originalAudioId &&
          variant.video.originalId === activeVariant.originalVideoId
      })
    }

    const audioFormatId = formatIdFromString(activeVariant.originalAudioId)
    const audioSegmentIndex = activeManifestVariant.audio.segmentIndex

    if (streamIsVideo) {
      bufferedRanges.push(createFullBufferRange(audioFormatId))
    } else {
      for (const buffered of bufferedInfo.audio) {
        bufferedRanges.push(createBufferedRange(audioFormatId, buffered, audioSegmentIndex))
      }
    }

    // Lazily initialize these variables as video data won't exist for audio-only playback
    let videoFormatId
    let videoSegmentIndex

    if (streamIsAudio && bufferedInfo.video.length > 0) {
      videoFormatId = formatIdFromString(activeVariant.originalVideoId)
      bufferedRanges.push(createFullBufferRange(videoFormatId))
    } else {
      for (const buffered of bufferedInfo.video) {
        if (!videoFormatId) {
          videoFormatId = formatIdFromString(activeVariant.originalVideoId)
        }

        if (!videoSegmentIndex) {
          videoSegmentIndex = activeManifestVariant.video.segmentIndex
        }

        bufferedRanges.push(createBufferedRange(videoFormatId, buffered, videoSegmentIndex))
      }
    }
  }
}

/**
 * @param {string} uri
 * @param {shaka.extern.Request} request
 * @param {Uint8Array} data
 * @returns {shaka.util.AbortableOperation<shaka.extern.Response>}
 */
function createCacheResponse(uri, request, data) {
  return AbortableOperation.completed({
    data,
    fromCache: true,
    headers: {},
    originalRequest: request,
    originalUri: uri,
    uri
  })
}

/**
 * @param {shaka.util.Error.Code} code
 * @param {...any} args
 */
function createRecoverableNetworkError(code, ...args) {
  return new ShakaError(ShakaError.Severity.RECOVERABLE, ShakaError.Category.NETWORK, code, ...args)
}

/**
 * @param {SabrStreamState} sabrStreamState
 */
function prepareSabrContexts(sabrStreamState) {
  /** @type {SabrContextUpdate[]} */
  const sabrContexts = []
  /** @type {number[]} */
  const unsentSabrContexts = []

  for (const ctxUpdate of sabrStreamState.sabrContexts.values()) {
    if (sabrStreamState.activeSabrContextTypes.has(ctxUpdate.type)) {
      sabrContexts.push(ctxUpdate)
    } else {
      unsentSabrContexts.push(ctxUpdate.type)
    }
  }

  return { sabrContexts, unsentSabrContexts }
}

/**
 * @template T
 * @param {import('googlevideo/shared-types').Part} part
 * @param {{ decode: (data: Uint8Array) => T }} decoder
 * @returns {T | undefined}
 */
function decodePart(part, decoder) {
  if (!part.data.chunks.length) return undefined

  try {
    const chunk = part.data.chunks.length === 1 ? part.data.chunks[0] : concatenateChunks(part.data.chunks)
    return decoder.decode(chunk)
  } catch {
    return undefined
  }
}

/**
 * @param {(args: void) => void} callback
 * @param {number} timeoutMs
 * @return TimeoutController
 */
function createTimeoutController(callback, timeoutMs) {
  return {
    _timeout: setTimeout(callback, timeoutMs),
    _resetCount: 0,
    resetTimeoutOnce() {
      if (this._resetCount > 0) return

      this.clearTimeout()
      this._timeout = setTimeout(callback, timeoutMs)
      this._resetCount++
    },
    clearTimeout() {
      clearTimeout(this._timeout)
    },
  }
}

/**
 * @param {number} max
 * @returns {RefreshBudget}
 */
function createRefreshBudget(max) {
  return {
    max,
    available: max,
  }
}

/**
 * Earns refresh credits back for time spent progressing through the video. Both allowances
 * earn at the same rate, so the healthy playback time they are earned from is tracked once
 * per stream rather than once per allowance.
 * @param {SabrStreamState} sabrStreamState
 * @param {number} [now]
 */
function recordHealthyPlaybackTime(sabrStreamState, now = Date.now()) {
  const gapMs = now - sabrStreamState.lastHealthyPlaybackAt
  sabrStreamState.lastHealthyPlaybackAt = now

  if (gapMs <= 0 || gapMs > MAX_HEALTHY_GAP_MS) return

  sabrStreamState.healthyPlaybackTimeMs += gapMs

  const earnedCredits = Math.floor(sabrStreamState.healthyPlaybackTimeMs / REFRESH_CREDIT_INTERVAL_MS)

  if (earnedCredits === 0) return

  sabrStreamState.healthyPlaybackTimeMs -= earnedCredits * REFRESH_CREDIT_INTERVAL_MS

  const budgets = [
    sabrStreamState.reloadRefreshBudget,
    sabrStreamState.forbiddenRefreshBudget,
    sabrStreamState.sabrErrorRefreshBudget,
  ]

  for (const budget of budgets) {
    budget.available = Math.min(budget.max, budget.available + earnedCredits)
  }
}

/**
 * Applies a refreshed playback session to the SABR state and the request being retried.
 * @param {CurrentState} currentState
 * @param {{url: string, ustreamerConfig?: string, poToken?: string}} refreshedPlayback
 */
function applyRefreshedPlayback(currentState, refreshedPlayback) {
  currentState.sabrStreamState.sabrUrl = refreshedPlayback.url

  // The retry starts a fresh playback session, so backoffs the server sent before or during
  // the recovery must not count towards the reload-on-backoff-loop detector, which would
  // otherwise abort this very retry and tear the player down
  currentState.cumulativeBackOffRequested = 0
  currentState.cumulativeBackOffTimeMs = 0

  // A backoff still pending from the old session would be waited out by the retry, which can
  // stall past the request timeout and abort it. Keep the policy itself, as it also carries
  // the playback cookie that later requests are built with
  if (currentState.sabrStreamState.nextRequestPolicy) {
    currentState.sabrStreamState.nextRequestPolicy.backoffTimeMs = 0
  }

  currentState.abrRequest.streamerContext.backoffTimeMs = undefined

  if (refreshedPlayback.ustreamerConfig) {
    currentState.abrRequest.videoPlaybackUstreamerConfig = base64ToU8(refreshedPlayback.ustreamerConfig)
  }

  if (refreshedPlayback.poToken) {
    // Later requests read the token from the stream state, this request from its body
    currentState.sabrStreamState.poToken = base64ToU8(refreshedPlayback.poToken)
    currentState.abrRequest.streamerContext.poToken = currentState.sabrStreamState.poToken
  }
}

/**
 * Asks the host to re-fetch the playback session, so playback can continue without
 * restarting the player. Concurrent requests (video + audio) share a single refresh,
 * which is spent from the allowance matching the reason.
 * @param {CurrentState} currentState
 * @param {RefreshReason} reason
 * @param {import('googlevideo/protos').ReloadPlaybackContext} [reloadPlaybackContext]
 * @returns {Promise<?{url: string, ustreamerConfig?: string, poToken?: string}>}
 */
async function refreshPlaybackInSession(currentState, reason, reloadPlaybackContext) {
  const sabrStreamState = currentState.sabrStreamState
  const refreshPlaybackContext = currentState.refreshPlaybackContext

  if (!refreshPlaybackContext) {
    return null
  }

  // Share a refresh that is already in flight rather than spending another credit
  if (sabrStreamState.pendingRefresh) {
    return sabrStreamState.pendingRefresh
  }

  const budget = sabrStreamState[REFRESH_BUDGET_BY_REASON[reason]]

  if (budget.available <= 0) {
    return null
  }

  budget.available -= 1

  sabrStreamState.pendingRefresh = refreshPlaybackContext({
    // The reload token belongs to a server requested reload, and nothing else
    reloadPlaybackContext: reason === 'reload' ? reloadPlaybackContext : undefined,
    tokenIsInvalid: reason === 'invalidPoToken',
  })
    .catch((refreshError) => {
      console.warn('Failed to refresh the SABR playback session', refreshError)
      return null
    })
    .finally(() => {
      sabrStreamState.pendingRefresh = null
    })

  return sabrStreamState.pendingRefresh
}

/**
 * Re-encodes the ABR request with the current SABR contexts and prepares it for another attempt.
 * @param {CurrentState} currentState
 */
function prepareRetryRequest(currentState) {
  const { sabrContexts, unsentSabrContexts } = prepareSabrContexts(currentState.sabrStreamState)

  currentState.abrRequest.streamerContext.sabrContexts = sabrContexts
  currentState.abrRequest.streamerContext.unsentSabrContexts = unsentSabrContexts

  let body

  try {
    body = VideoPlaybackAbrRequest.encode(currentState.abrRequest).finish()
  } catch (error) {
    console.error('Invalid VideoPlaybackAbrRequest data', currentState.abrRequest)
    throw error
  }

  currentState.requestInit = {
    body,
    method: 'POST',
    headers: {
      'content-type': 'application/x-protobuf',
      'accept-encoding': 'identity',
      accept: 'application/vnd.yt-ump',
    },
    signal: currentState.abortController.signal,
  }

  currentState.abortStatus.timedOut = false
  currentState.abortStatus.finished = false
}

/**
 * @param {OperationInputs} operationInputs - readonly
 * @param {CurrentState} currentState - can be updated
 */
async function doRequest(
  operationInputs,
  currentState,
) {
  let response
  /** @type {CompositeBuffer | null} */
  let chunkedDataBuffer = null
  /** @type {Uint8Array[]} */
  const responseDataChunks = []
  let segmentComplete = false
  let shouldRetry = false
  let shouldRetryDueToNextRequestPolicy = false
  let stopReading = false
  let forbiddenRecoveryAttempted = false
  /** @type {import('googlevideo/protos').ReloadPlaybackContext | undefined} */
  let reloadPlaybackContext

  let invalidPoToken = false
  let error

  if (currentState.sabrStreamState.playerReloadRequested) {
    // Multiple requests might be issued at the same time, other requests should abort themselves once reload requested
    throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
  }

  try {
    let shouldReloadDueToBackoffLoop = false
    if ((currentState.sabrStreamState.nextRequestPolicy?.backoffTimeMs || 0) > 0) {
      const currentBackoffTimeMs = currentState.sabrStreamState.nextRequestPolicy.backoffTimeMs
      currentState.eventEmitter.emit('backoff-requested', { backoffMs: currentBackoffTimeMs })
      // Wait but can be aborted
      await new Promise((resolve, reject) => {
        setTimeout(resolve, currentBackoffTimeMs)
        currentState.abortController.signal.addEventListener('abort', reject)
      })
      // Must reset AFTER waiting to avoid requested aborted
      // Since long backoff time mostly happens on the start of video playback we only reset timeout once
      // i.e. backoff time parts received will not reset timeout - counted as video loading issue
      currentState.timeoutController?.resetTimeoutOnce()

      currentState.cumulativeBackOffTimeMs += currentState.sabrStreamState.nextRequestPolicy.backoffTimeMs
      currentState.cumulativeBackOffRequested += 1
      const timeoutMs = operationInputs.request.retryParameters.timeout
      // Detect infinite backoff loop by no. of times requested and cumulative time approaching timeout
      if (currentState.cumulativeBackOffRequested >= 3 || (timeoutMs > 0 && timeoutMs <= (currentState.cumulativeBackOffTimeMs + currentBackoffTimeMs))) {
        shouldReloadDueToBackoffLoop = true
      }
    }
    if (shouldReloadDueToBackoffLoop || currentState.cumulativeRetryDueToNextRequestPolicy >= 100) {
      // Fire fake reload event due to detecting retry loop
      currentState.sabrStreamState.playerReloadRequested = true
      if (!currentState.abortController.signal.aborted) {
        currentState.abortController.abort()
        currentState.eventEmitter.emit('reload')
      }
    }

    const sabrURL = new URL(currentState.sabrStreamState.sabrUrl)
    sabrURL.searchParams.set('rn', String(currentState.sabrStreamState.requestNumber++))
    response = await fetch(sabrURL.toString(), currentState.requestInit)

    operationInputs.headersReceived({})

    if ((response.status === 401 || response.status === 403) && !forbiddenRecoveryAttempted) {
      // The streaming URL or the playback session has most likely expired. Fetch a fresh
      // playback session in place and retry, instead of failing playback outright.
      forbiddenRecoveryAttempted = true
      // An error page carries no UMP data, so never parse it: either the retry replaces this
      // response, or the status falls through to the terminal error below
      stopReading = true

      const refreshedPlayback = await refreshPlaybackInSession(currentState, 'forbidden')

      if (refreshedPlayback?.url) {
        applyRefreshedPlayback(currentState, refreshedPlayback)

        shouldRetry = true
      }
    }

    const { itag, lastModified, xtags } = formatIdFromString(operationInputs.formatIdString)
    let mediaHeaderId

    const reader = response.body.getReader()
    let readObj = stopReading ? { done: true } : await reader.read()

    while (!readObj.done && !currentState.abortStatus.finished && !stopReading) {
      if (chunkedDataBuffer) {
        chunkedDataBuffer.append(readObj.value)
      } else {
        chunkedDataBuffer = new CompositeBuffer([readObj.value])
      }

      const remainingData = new UmpReader(chunkedDataBuffer).read((part) => {
        switch (part.type) {
          case UMPPartId.STREAM_PROTECTION_STATUS: {
            const streamProtectionStatus = decodePart(part, StreamProtectionStatus)
            if (!streamProtectionStatus) break

            if (streamProtectionStatus.status === 3) {
              invalidPoToken = true
            }
            break
          }
          case UMPPartId.SABR_ERROR: {
            const sabrError = decodePart(part, SabrError)
            if (!sabrError) break

            error = `SABR Error: type: ${sabrError.type}, code: ${sabrError.code}`
            break
          }
          case UMPPartId.SABR_REDIRECT: {
            const sabrRedirect = decodePart(part, SabrRedirect)
            if (!sabrRedirect?.url) break

            currentState.sabrStreamState.sabrUrl = sabrRedirect.url
            shouldRetry = true
            break
          }
          case UMPPartId.MEDIA_HEADER: {
            if (mediaHeaderId === undefined) {
              const mediaHeader = decodePart(part, MediaHeader)
              if (!mediaHeader) break

              if (
                mediaHeader.formatId.itag === itag &&
                mediaHeader.formatId.lastModified === lastModified &&
                mediaHeader.formatId.xtags === xtags
              ) {
                if (operationInputs.isInit && mediaHeader.isInitSeg) {
                  mediaHeaderId = mediaHeader.headerId
                } else if (!operationInputs.isInit && mediaHeader.sequenceNumber === operationInputs.sequenceNumber) {
                  mediaHeaderId = mediaHeader.headerId
                }
              }
            }

            break
          }
          case UMPPartId.MEDIA: {
            if (mediaHeaderId === part.data.getUint8(0)) {
              responseDataChunks.push(...part.data.split(1).remainingBuffer.chunks)
            }
            break
          }
          case UMPPartId.MEDIA_END: {
            if (mediaHeaderId === part.data.getUint8(0)) {
              segmentComplete = true
              currentState.abortStatus.finished = true
              currentState.abortController.abort()
            }
            break
          }
          case UMPPartId.NEXT_REQUEST_POLICY: {
            const nextRequestPolicy = decodePart(part, NextRequestPolicy)

            shouldRetry = true
            shouldRetryDueToNextRequestPolicy = true

            currentState.sabrStreamState.nextRequestPolicy = nextRequestPolicy
            currentState.abrRequest.streamerContext.playbackCookie = nextRequestPolicy?.playbackCookie ? PlaybackCookie.encode(nextRequestPolicy.playbackCookie).finish() : undefined

            currentState.abrRequest.streamerContext.backoffTimeMs = nextRequestPolicy?.backoffTimeMs
            break
          }
          case UMPPartId.FORMAT_INITIALIZATION_METADATA: {
            break
          }
          case UMPPartId.SABR_CONTEXT_UPDATE: {
            const sabrContextUpdate = decodePart(part, SabrContextUpdate)
            if (!sabrContextUpdate) break

            if (sabrContextUpdate.type !== undefined && sabrContextUpdate.value?.length) {
              if (
                sabrContextUpdate.writePolicy === SabrContextWritePolicy.KEEP_EXISTING &&
                currentState.sabrStreamState.sabrContexts.has(sabrContextUpdate.type)
              ) {
                break
              }

              currentState.sabrStreamState.sabrContexts.set(sabrContextUpdate.type, sabrContextUpdate)

              if (sabrContextUpdate.sendByDefault) {
                currentState.sabrStreamState.activeSabrContextTypes.add(sabrContextUpdate.type)
              }
            }
            break
          }
          case UMPPartId.SABR_CONTEXT_SENDING_POLICY: {
            const sabrContextSendingPolicy = decodePart(part, SabrContextSendingPolicy)
            if (!sabrContextSendingPolicy) break

            for (const startPolicy of sabrContextSendingPolicy.startPolicy) {
              if (!currentState.sabrStreamState.activeSabrContextTypes.has(startPolicy)) {
                currentState.sabrStreamState.activeSabrContextTypes.add(startPolicy)
              }
            }

            for (const stopPolicy of sabrContextSendingPolicy.stopPolicy) {
              if (currentState.sabrStreamState.activeSabrContextTypes.has(stopPolicy)) {
                currentState.sabrStreamState.activeSabrContextTypes.delete(stopPolicy)
              }
            }

            for (const discardPolicy of sabrContextSendingPolicy.discardPolicy) {
              if (currentState.sabrStreamState.sabrContexts.has(discardPolicy)) {
                currentState.sabrStreamState.sabrContexts.delete(discardPolicy)
              }
            }
            break
          }
          case UMPPartId.RELOAD_PLAYER_RESPONSE: {
            const reloadContext = decodePart(part, ReloadPlaybackContext)
            if (!reloadContext) break

            // The server wants a fresh playback session. Ask it to reload using the token
            // it gave us, instead of aborting everything and restarting the whole player.
            reloadPlaybackContext = reloadContext
            shouldRetry = true
            stopReading = true
            break
          }
          default: {
            break
          }
        }
      })

      if (!currentState.abortStatus.finished && !stopReading) {
        if (remainingData) {
          chunkedDataBuffer = remainingData.data
        } else {
          chunkedDataBuffer = null
        }

        readObj = await reader.read()
      }
    }

    if (stopReading) {
      // Stop consuming this response so the connection is released for the retry,
      // without aborting the whole SABR session.
      try {
        await reader.cancel()
      } catch {
        // The stream may already have been closed by the server
      }
    }
  } catch (error) {
    if (currentState.abortStatus.cancelled) {
      throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
    } else if (currentState.abortStatus.timedOut) {
      throw createRecoverableNetworkError(ShakaError.Code.TIMEOUT, operationInputs.uri, operationInputs.requestType)
    } else if (!currentState.abortStatus.finished) {
      throw createRecoverableNetworkError(ShakaError.Code.HTTP_ERROR, operationInputs.uri, error, operationInputs.requestType)
    }
  }

  if (currentState.abortStatus.cancelled) {
    throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
  } else if (currentState.abortStatus.timedOut) {
    throw createRecoverableNetworkError(ShakaError.Code.TIMEOUT, operationInputs.uri, operationInputs.requestType)
  }

  if (responseDataChunks.length > 0 && segmentComplete) {
    // Playback is progressing, so earn back the refresh allowances on long videos
    recordHealthyPlaybackTime(currentState.sabrStreamState)

    const data = /** @__NOINLINE__ */ concatenateChunks(responseDataChunks)

    if (operationInputs.isInit) {
      currentState.initDataCache.set(operationInputs.formatIdString, data)
    }

    /** @type {shaka.extern.Response} */
    return {
      uri: operationInputs.uri,
      originalUri: operationInputs.uri,
      data,
      status: response.status,
      headers: {},
      fromCache: false,
      originalRequest: operationInputs.request,
    }
  } else if (shouldRetry) {
    if (reloadPlaybackContext) {
      const refreshedPlayback = await refreshPlaybackInSession(currentState, 'reload', reloadPlaybackContext)

      if (refreshedPlayback?.url) {
        applyRefreshedPlayback(currentState, refreshedPlayback)
      } else {
        // The session could not be refreshed in place, fall back to reloading the player view
        currentState.sabrStreamState.playerReloadRequested = true
        if (!currentState.abortController.signal.aborted) {
          currentState.abortController.abort()
          currentState.eventEmitter.emit('reload')
        }

        throw createRecoverableNetworkError(ShakaError.Code.OPERATION_ABORTED, operationInputs.uri, operationInputs.requestType)
      }
    }

    if (shouldRetryDueToNextRequestPolicy) {
      // Only count on actual retry to avoid counting false positive (when segmentComplete
      currentState.cumulativeRetryDueToNextRequestPolicy += 1
    }

    prepareRetryRequest(currentState)

    return doRequest(operationInputs, currentState)
  } else if (invalidPoToken) {
    // The streamer rejected the poToken, so recover with a newly minted one
    const refreshedPlayback = await refreshPlaybackInSession(currentState, 'invalidPoToken')

    if (refreshedPlayback?.url) {
      applyRefreshedPlayback(currentState, refreshedPlayback)
      prepareRetryRequest(currentState)

      return doRequest(operationInputs, currentState)
    }

    throw new ShakaError(
      ShakaError.Severity.CRITICAL,
      ShakaError.Category.NETWORK,
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      new Error('Invalid PO token'),
      operationInputs.requestType,
    )
  } else if (error) {
    // The streamer reported a SABR error. A fresh playback session may resolve a transient one,
    // so try that once in place: blind retries only run out and drop to the legacy formats
    if (!forbiddenRecoveryAttempted) {
      const refreshedPlayback = await refreshPlaybackInSession(currentState, 'sabrError')

      if (refreshedPlayback?.url) {
        applyRefreshedPlayback(currentState, refreshedPlayback)
        prepareRetryRequest(currentState)

        return doRequest(operationInputs, currentState)
      }
    }

    // Passed through as a string: an Error wrapper would serialise as {} in the player error
    // log and hide the type and code that identify the failure
    throw createRecoverableNetworkError(
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      error,
      operationInputs.requestType,
    )
  } else if (responseDataChunks.length > 0 && !segmentComplete) {
    throw createRecoverableNetworkError(
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      new Error('Incomplete segment, missing MEDIA_END part'),
      operationInputs.requestType,
    )
  } else if (response.status === 200) {
    throw createRecoverableNetworkError(
      ShakaError.Code.HTTP_ERROR,
      operationInputs.uri,
      new Error('Empty response, this should not happen'),
      operationInputs.requestType,
    )
  } else {
    const severity = response.status === 401 || response.status === 403
      ? ShakaError.Severity.CRITICAL
      : ShakaError.Severity.RECOVERABLE

    throw new ShakaError(
      severity,
      ShakaError.Category.NETWORK,
      ShakaError.Code.BAD_HTTP_STATUS,
      operationInputs.uri,
      response.status,
      '',
      {},
      operationInputs.requestType,
      operationInputs.uri,
    )
  }
}

/**
 * @param {import('../../views/Watch/Watch').SabrData} sabrData
 * @param {() => shaka.Player} getPlayer
 * @param {() => shaka.extern.Manifest} getManifest
 * @param {import('vue').ComputedRef<number>} playerWidth
 * @param {import('vue').ComputedRef<number>} playerHeight
 * @param {RefreshPlaybackContext} [refreshPlaybackContext] Called when the server requests a playback reload
 * @return SabrStream
 */
export function setupSabrScheme(sabrData, getPlayer, getManifest, playerWidth, playerHeight, refreshPlaybackContext) {
  const eventEmitter = new EventEmitterLike()

  /**
   * Caches the init data until the video ends
   * that way changing qualities and between audio and DASH
   * doesn't have to fetch the init data and segment index again
   * @type {Map<string, Uint8Array>}
   */
  const initDataCache = new Map()

  const videoPlaybackUstreamerConfig = base64ToU8(sabrData.ustreamerConfig)
  const clientInfo = deepCopy(sabrData.clientInfo)

  /** @type {SabrStreamState} */
  const sabrStreamState = {
    sabrUrl: sabrData.url,
    poToken: base64ToU8(sabrData.poToken),
    activeSabrContextTypes: new Set(),
    sabrContexts: new Map(),
    nextRequestPolicy: undefined,
    playerReloadRequested: false,
    requestNumber: 0,
    healthyPlaybackTimeMs: 0,
    lastHealthyPlaybackAt: Date.now(),
    reloadRefreshBudget: createRefreshBudget(MAX_RELOAD_REFRESH_CREDITS),
    forbiddenRefreshBudget: createRefreshBudget(MAX_FORBIDDEN_REFRESH_CREDITS),
    sabrErrorRefreshBudget: createRefreshBudget(MAX_SABR_ERROR_REFRESH_CREDITS),
    pendingRefresh: null,
  }

  shaka.net.NetworkingEngine.registerScheme('sabr', (uri, request, requestType, _progressUpdated, headersReceived, _config) => {
    // lazily fetch it as the variable is only set after setupSabrScheme is called
    // but it will definitely exist when we receive a request here.
    const player = getPlayer()
    if (player == null) {
      // This is true during reload, returning a promise to suppress error
      return new AbortableOperation(Promise.resolve())
    }
    const isAudioOnly = player.isAudioOnly()

    const url = new URL(request.uris[0])

    const isInit = url.searchParams.has('init')
    const formatIdString = url.searchParams.get('formatId')

    if (isInit && initDataCache.has(formatIdString)) {
      return /** @__NOINLINE__ */ createCacheResponse(uri, request, initDataCache.get(formatIdString))
    }

    const variantTracks = player.getVariantTracks()
    const activeVariant = variantTracks.find(track => track.active)

    const streamIsAudio = url.pathname === 'audio'
    const streamIsVideo = url.pathname === 'video'

    let audioFormatId
    let videoFormatId

    if (streamIsAudio) {
      audioFormatId = formatIdFromString(formatIdString)

      if (isAudioOnly) {
        // We need to specify a video format even for audio only otherwise we get an error response
        videoFormatId = formatIdFromString(url.searchParams.get('videoFormatId'))
      } else {
        videoFormatId = formatIdFromString((activeVariant ?? variantTracks[0]).originalVideoId)
      }
    } else if (streamIsVideo) {
      videoFormatId = formatIdFromString(formatIdString)

      // for the first fetching of the initial data there won't be an active variant
      // (shaka-player only sets it to active after it has fetched the init/segment data)
      if (activeVariant) {
        audioFormatId = formatIdFromString(activeVariant.originalAudioId)
      } else {
        const candidates = variantTracks.filter((track) => track.audioRoles.includes('main'))

        const probableAudioFormat = candidates.reduce((previous, current) => {
          return current.audioBandwidth >= previous.audioBandwidth ? current : previous
        }, candidates[0])

        audioFormatId = formatIdFromString(probableAudioFormat.originalAudioId)
      }
    }

    /** @type {import('googlevideo/protos').BufferedRange[]} */
    const bufferedRanges = []

    if (!isInit && activeVariant) {
      /** @__NOINLINE__ */ fillBufferedRanges(player, getManifest(), isAudioOnly, streamIsVideo, streamIsAudio, bufferedRanges, activeVariant)
    }

    let playerTimeMs = '0'

    if (url.searchParams.has('startTimeMs')) {
      playerTimeMs = url.searchParams.get('startTimeMs')
    }

    const drcEnabled = url.searchParams.has('drc') || !!(activeVariant && activeVariant.audioRoles.includes('drc'))
    const enableVoiceBoost = url.searchParams.has('vb') || !!(activeVariant && activeVariant.audioRoles.includes('vb'))

    const resolution = streamIsVideo ? parseInt(url.searchParams.get('resolution')) : undefined

    const { sabrContexts, unsentSabrContexts } = prepareSabrContexts(sabrStreamState)

    /** @type {VideoPlaybackAbrRequest} */
    const requestData = {
      clientAbrState: {
        bandwidthEstimate: String(Math.round(player.getStats().estimatedBandwidth)),
        timeSinceLastManualFormatSelectionMs: streamIsVideo ? '0' : undefined,
        stickyResolution: resolution,
        lastManualSelectedResolution: resolution,
        playbackRate: player.getPlaybackRate(),
        enabledTrackTypesBitfield: streamIsAudio ? 1 : 0,
        drcEnabled,
        enableVoiceBoost,
        playerTimeMs,
        clientViewportWidth: playerWidth.value,
        clientViewportHeight: playerHeight.value,
        clientViewportIsFlexible: false
      },
      preferredAudioFormatIds: [audioFormatId],
      preferredVideoFormatIds: [videoFormatId],
      preferredSubtitleFormatIds: [],
      selectedFormatIds: isInit ? [] : [audioFormatId, videoFormatId],
      bufferedRanges,
      streamerContext: {
        poToken: sabrStreamState.poToken,
        clientInfo,
        sabrContexts,
        unsentSabrContexts,
        playbackCookie: sabrStreamState.nextRequestPolicy?.playbackCookie ? PlaybackCookie.encode(sabrStreamState.nextRequestPolicy.playbackCookie).finish() : undefined,
      },
      field1000: [],
      videoPlaybackUstreamerConfig,
    }

    let body

    try {
      body = VideoPlaybackAbrRequest.encode(requestData).finish()
    } catch (error) {
      console.error('Invalid VideoPlaybackAbrRequest data', requestData)
      throw error
    }

    const sequenceNumber = parseInt(url.searchParams.get('sq'))

    /**
     * Stores whatever state that should be updated across the whole "session"
     * @type {OperationInputs}
     */
    const opInputs = {
      uri,
      request,
      requestType,
      headersReceived,

      formatIdString,
      isInit,
      sequenceNumber,
    }

    const abortController = new AbortController()

    /** @type {RequestInit} */
    const init = {
      body,
      method: 'POST',
      headers: {
        'content-type': 'application/x-protobuf',
        'accept-encoding': 'identity',
        accept: 'application/vnd.yt-ump',
      },
      signal: abortController.signal,
    }

    /**
     * Stores whatever state that should be updated across the whole "session"
     * @type {AbortStatus}
     */
    const abortStatus = {
      cancelled: false,
      timedOut: false,
      finished: false,
    }

    const timeoutMs = request.retryParameters.timeout
    let timeoutController = null
    if (timeoutMs) {
      timeoutController = createTimeoutController(() => {
        abortStatus.timedOut = true
        abortController.abort()
      }, timeoutMs)
    }

    /**
     * Stores whatever state that should be updated across the whole "session"
     * @type {CurrentState}
     */
    const currentState = {
      initDataCache,
      abrRequest: requestData,
      requestInit: init,
      abortStatus: abortStatus,
      abortController,
      sabrStreamState,
      timeoutController,
      eventEmitter,
      refreshPlaybackContext,
      cumulativeBackOffTimeMs: 0,
      cumulativeBackOffRequested: 0,
      cumulativeRetryDueToNextRequestPolicy: 0,
    }

    const pendingRequest = doRequest(opInputs, currentState)

    const op = new AbortableOperation(pendingRequest, () => {
      abortStatus.cancelled = true
      abortController.abort()
      return Promise.resolve()
    })

    if (timeoutController) {
      op.finally(() => {
        timeoutController.clearTimeout()
      })
    }

    return op
  })

  const cleanup = () => {
    shaka.net.NetworkingEngine.unregisterScheme('sabr')
    initDataCache.clear()
  }

  return {
    onBackoffRequested(callback) {
      eventEmitter.on('backoff-requested', callback)
    },
    onReloadOnce(callback) {
      eventEmitter.once('reload', callback)
    },
    cleanup,
  }
}
