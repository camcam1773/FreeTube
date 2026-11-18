import { beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshSabrPlaybackSession } from '../../src/renderer/helpers/api/local.js'

const PLAYER_URL = 'https://stream.example/player?sabr=1'
const RELOAD_CONTEXT = { token: 'server-reload-token' }

function makeCachedState(overrides = {}) {
  return {
    videoId: 'video-id',
    session: {
      context: { client: { clientName: 1 } },
      actions: { execute: vi.fn() },
    },
    player: {
      signature_timestamp: 123,
      decipher: vi.fn().mockImplementation(async (url) => `deciphered:${url}`),
    },
    poToken: 'old-token',
    initialAttestationData: { R: {}, T: 'eacr' },
    ytConfig: {},
    ...overrides,
  }
}

function playerResponse(url) {
  return {
    data: {
      streamingData: url ? { serverAbrStreamingUrl: url } : {},
      playerConfig: {
        mediaCommonConfig: {
          mediaUstreamerRequestConfig: { videoPlaybackUstreamerConfig: 'config' },
        },
      },
    },
  }
}

describe('refreshSabrPlaybackSession', () => {
  beforeEach(() => {
    window.ftElectron = { generatePoToken: vi.fn().mockResolvedValue('new-token') }
  })

  it('returns null without a matching cached session', async () => {
    await expect(refreshSabrPlaybackSession('video-id', {}, null)).resolves.toBeNull()
    await expect(refreshSabrPlaybackSession('other-video', {}, makeCachedState())).resolves.toBeNull()
    await expect(refreshSabrPlaybackSession('video-id', {}, makeCachedState({ poToken: undefined }))).resolves.toBeNull()
  })

  it('forwards the reload token YouTube sent in RELOAD_PLAYER_RESPONSE', async () => {
    const cachedState = makeCachedState()
    cachedState.session.actions.execute.mockResolvedValue(playerResponse(PLAYER_URL))

    const result = await refreshSabrPlaybackSession('video-id', { reloadPlaybackContext: RELOAD_CONTEXT }, cachedState)

    const [, body] = cachedState.session.actions.execute.mock.calls[0]
    expect(body.playbackContext.reloadPlaybackContext).toEqual(RELOAD_CONTEXT)
    expect(result.url).toBe(`deciphered:${PLAYER_URL}`)
    expect(result.ustreamerConfig).toBe('config')
  })

  it('mints and uses a new token when the stream rejected it', async () => {
    const cachedState = makeCachedState()
    cachedState.session.actions.execute.mockResolvedValue(playerResponse(PLAYER_URL))

    const result = await refreshSabrPlaybackSession('video-id', { tokenIsInvalid: true }, cachedState)

    expect(window.ftElectron.generatePoToken).toHaveBeenCalledTimes(1)
    const [, body] = cachedState.session.actions.execute.mock.calls[0]
    expect(body.serviceIntegrityDimensions.poToken).toBe('new-token')
    expect(result.poToken).toBe('new-token')
  })

  it('gives up when a rejected token cannot be replaced', async () => {
    const cachedState = makeCachedState()
    window.ftElectron.generatePoToken.mockRejectedValue(new Error('attestation failed'))

    await expect(refreshSabrPlaybackSession('video-id', { tokenIsInvalid: true }, cachedState)).resolves.toBeNull()
    expect(cachedState.session.actions.execute).not.toHaveBeenCalled()
  })

  it('renews the token on a 403 recovery and uses it when minting succeeds', async () => {
    const cachedState = makeCachedState()
    cachedState.session.actions.execute.mockResolvedValue(playerResponse(PLAYER_URL))

    const result = await refreshSabrPlaybackSession('video-id', { renewToken: true }, cachedState)

    expect(window.ftElectron.generatePoToken).toHaveBeenCalledTimes(1)
    const [, body] = cachedState.session.actions.execute.mock.calls[0]
    expect(body.serviceIntegrityDimensions.poToken).toBe('new-token')
    expect(result.poToken).toBe('new-token')
  })

  it('still retries with a fresh URL when 403 token renewal fails', async () => {
    const cachedState = makeCachedState()
    cachedState.session.actions.execute.mockResolvedValue(playerResponse(PLAYER_URL))
    window.ftElectron.generatePoToken.mockRejectedValue(new Error('attestation failed'))

    const result = await refreshSabrPlaybackSession('video-id', { renewToken: true }, cachedState)

    expect(cachedState.session.actions.execute).toHaveBeenCalledTimes(1)
    expect(result.url).toBe(`deciphered:${PLAYER_URL}`)
    expect(result.poToken).toBe('old-token')
  })

  it('renews once and refetches when YouTube returns no streaming URL', async () => {
    const cachedState = makeCachedState()
    cachedState.session.actions.execute
      .mockResolvedValueOnce(playerResponse(null))
      .mockResolvedValueOnce(playerResponse(PLAYER_URL))

    const result = await refreshSabrPlaybackSession('video-id', {}, cachedState)

    expect(window.ftElectron.generatePoToken).toHaveBeenCalledTimes(1)
    expect(cachedState.session.actions.execute).toHaveBeenCalledTimes(2)
    expect(result.url).toBe(`deciphered:${PLAYER_URL}`)
    expect(result.poToken).toBe('new-token')
  })

  it('returns null when renewal fails and there is no streaming URL', async () => {
    const cachedState = makeCachedState()
    cachedState.session.actions.execute.mockResolvedValue(playerResponse(null))
    window.ftElectron.generatePoToken.mockResolvedValue(undefined)

    await expect(refreshSabrPlaybackSession('video-id', {}, cachedState)).resolves.toBeNull()
  })

  it('returns null when no session can be obtained', async () => {
    const cachedState = makeCachedState()
    cachedState.session.actions.execute.mockResolvedValue(playerResponse(null))

    await expect(refreshSabrPlaybackSession('video-id', { renewToken: true }, cachedState)).resolves.toBeNull()
  })
})
