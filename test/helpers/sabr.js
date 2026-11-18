import { CompositeBuffer, UmpWriter } from 'googlevideo/ump'
import {
  MediaHeader,
  ReloadPlaybackContext,
  SabrError,
  StreamProtectionStatus,
  UMPPartId,
} from 'googlevideo/protos'

import { createRefreshBudget } from '../../src/renderer/helpers/player/SabrSchemePlugin.js'

export const FORMAT_ID = '244-123-'

/** Encodes a list of { type, data } UMP parts into a single byte array. */
export function encodeUmp(parts) {
  const buffer = new CompositeBuffer([])
  const writer = new UmpWriter(buffer)

  for (const { type, data } of parts) {
    writer.write(type, data)
  }

  const bytes = new Uint8Array(buffer.chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0

  for (const chunk of buffer.chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }

  return bytes
}

export function mediaHeaderPart(isInit = true, sequenceNumber = 0) {
  return {
    type: UMPPartId.MEDIA_HEADER,
    data: MediaHeader.encode({
      headerId: 1,
      isInitSeg: isInit,
      sequenceNumber,
      formatId: { itag: 244, lastModified: '123', xtags: '' },
    }).finish(),
  }
}

export function mediaParts(payload = new Uint8Array([9, 8, 7])) {
  return [
    { type: UMPPartId.MEDIA, data: new Uint8Array([1, ...payload]) },
    { type: UMPPartId.MEDIA_END, data: new Uint8Array([1]) },
  ]
}

export function statusPart(status) {
  return { type: UMPPartId.STREAM_PROTECTION_STATUS, data: StreamProtectionStatus.encode({ status }).finish() }
}

export function sabrErrorPart(type = 'invalid', code = 2) {
  return { type: UMPPartId.SABR_ERROR, data: SabrError.encode({ type, code }).finish() }
}

export function reloadPart(token = 'server-reload-token') {
  return {
    type: UMPPartId.RELOAD_PLAYER_RESPONSE,
    data: ReloadPlaybackContext.encode({ reloadPlaybackParams: { token } }).finish(),
  }
}

/**
 * Minimal fetch Response stand-in. doRequest only reads status, url and
 * body.getReader(), so a real Response isn't needed (and isn't portable to jsdom).
 */
export function makeResponse(status, parts) {
  const bytes = parts ? encodeUmp(parts) : new Uint8Array()
  let delivered = false

  return {
    status,
    ok: status >= 200 && status < 300,
    url: 'https://stream.example/videoplayback?sabr=1',
    body: {
      getReader() {
        return {
          async read() {
            if (delivered) return { done: true, value: undefined }
            delivered = true
            return { done: false, value: bytes }
          },
          async cancel() {},
        }
      },
    },
  }
}

export function makeSabrStreamState(overrides = {}) {
  return {
    sabrUrl: 'https://stream.example/videoplayback?sabr=1',
    poToken: new Uint8Array([1, 2, 3]),
    activeSabrContextTypes: new Set(),
    sabrContexts: new Map(),
    nextRequestPolicy: undefined,
    playerReloadRequested: false,
    requestNumber: 0,
    healthyPlaybackTimeMs: 0,
    lastHealthyPlaybackAt: Date.now(),
    reloadRefreshBudget: createRefreshBudget(3),
    forbiddenRefreshBudget: createRefreshBudget(2),
    sabrErrorRefreshBudget: createRefreshBudget(1),
    pendingRefresh: null,
    ...overrides,
  }
}

export function makeCurrentState(overrides = {}) {
  const { emit = () => {}, sabrStreamState: stateOverrides = {}, ...rest } = overrides
  const sabrStreamState = makeSabrStreamState(stateOverrides)

  return {
    initDataCache: new Map(),
    abrRequest: {
      clientAbrState: {},
      preferredAudioFormatIds: [],
      preferredVideoFormatIds: [],
      preferredSubtitleFormatIds: [],
      selectedFormatIds: [],
      bufferedRanges: [],
      streamerContext: { poToken: sabrStreamState.poToken },
      field1000: [],
    },
    requestInit: { body: new Uint8Array(), method: 'POST', headers: {} },
    abortStatus: { cancelled: false, timedOut: false, finished: false },
    abortController: new AbortController(),
    timeoutController: null,
    refreshPlaybackContext: async () => null,
    cumulativeBackOffTimeMs: 0,
    cumulativeBackOffRequested: 0,
    cumulativeRetryDueToNextRequestPolicy: 0,
    sabrStreamState,
    eventEmitter: { emit },
    ...rest,
  }
}

export function makeOperationInputs(overrides = {}) {
  return {
    uri: 'sabr:video?formatId=244-123-&resolution=480&init',
    request: { retryParameters: { timeout: 600000 } },
    requestType: 1,
    headersReceived: () => {},
    formatIdString: FORMAT_ID,
    isInit: true,
    sequenceNumber: 0,
    ...overrides,
  }
}

export const REFRESHED_PLAYBACK = {
  url: 'https://stream.example/fresh?sabr=1',
  ustreamerConfig: 'AAAA',
  poToken: 'AQIDBA==',
}
