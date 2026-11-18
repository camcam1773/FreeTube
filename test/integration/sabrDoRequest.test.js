import shaka from 'shaka-player'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoPlaybackAbrRequest } from 'googlevideo/protos'

import { doRequest } from '../../src/renderer/helpers/player/SabrSchemePlugin.js'
import {
  makeCurrentState,
  makeOperationInputs,
  makeResponse,
  mediaHeaderPart,
  mediaParts,
  REFRESHED_PLAYBACK,
  reloadPart,
  sabrErrorPart,
  statusPart,
} from '../helpers/sabr.js'

const { Code } = shaka.util.Error
const SUCCESS = () => makeResponse(200, [mediaHeaderPart(), ...mediaParts()])

describe('SABR doRequest recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a completed segment without refreshing the session', async () => {
    fetch.mockResolvedValue(SUCCESS())
    const emit = vi.fn()

    const result = await doRequest(makeOperationInputs(), makeCurrentState({ emit }))

    expect(result.status).toBe(200)
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([9, 8, 7]))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(emit).not.toHaveBeenCalled()
  })

  it('retries in place on RELOAD_PLAYER_RESPONSE without reloading the view', async () => {
    fetch
      .mockResolvedValueOnce(makeResponse(200, [reloadPart()]))
      .mockResolvedValueOnce(SUCCESS())
    const emit = vi.fn()
    const refreshPlaybackContext = vi.fn().mockResolvedValue(REFRESHED_PLAYBACK)
    const currentState = makeCurrentState({
      emit,
      sabrStreamState: { sabrUrl: 'https://stream.example/old?sabr=1' },
      refreshPlaybackContext,
    })

    const result = await doRequest(makeOperationInputs(), currentState)

    expect(result.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(emit).not.toHaveBeenCalled()
    expect(refreshPlaybackContext).toHaveBeenCalledWith(expect.objectContaining({
      reloadPlaybackContext: expect.objectContaining({
        reloadPlaybackParams: { token: 'server-reload-token' },
      }),
    }))
    expect(currentState.sabrStreamState.sabrUrl).toBe(REFRESHED_PLAYBACK.url)
  })

  it('falls back to a single view reload when an in-place reload refresh fails', async () => {
    fetch.mockResolvedValue(makeResponse(200, [reloadPart()]))
    const emit = vi.fn()
    const refreshPlaybackContext = vi.fn().mockResolvedValue(null)
    const currentState = makeCurrentState({ emit, refreshPlaybackContext })

    await expect(doRequest(makeOperationInputs(), currentState)).rejects.toMatchObject({ code: Code.OPERATION_ABORTED })

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('reload')
    expect(currentState.sabrStreamState.playerReloadRequested).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refreshes the session in place after a 403 and retries with the new URL', async () => {
    fetch
      .mockResolvedValueOnce(makeResponse(403))
      .mockResolvedValueOnce(SUCCESS())
    const emit = vi.fn()
    const refreshPlaybackContext = vi.fn().mockResolvedValue(REFRESHED_PLAYBACK)
    const currentState = makeCurrentState({
      emit,
      sabrStreamState: { sabrUrl: 'https://stream.example/old?sabr=1' },
      refreshPlaybackContext,
    })

    const result = await doRequest(makeOperationInputs(), currentState)

    expect(result.status).toBe(200)
    expect(emit).not.toHaveBeenCalled()
    expect(refreshPlaybackContext).toHaveBeenCalledWith({
      reloadPlaybackContext: undefined,
      tokenIsInvalid: false,
      renewToken: true,
    })
    expect(currentState.sabrStreamState.sabrUrl).toBe(REFRESHED_PLAYBACK.url)
  })

  it('reloads the view instead of surfacing a raw 403 when the forbidden budget is empty', async () => {
    fetch.mockResolvedValue(makeResponse(403))
    const emit = vi.fn()
    const streamState = { forbiddenRefreshBudget: { max: 2, available: 0 } }
    const refreshPlaybackContext = vi.fn()

    const promise = doRequest(
      makeOperationInputs(),
      makeCurrentState({ emit, sabrStreamState: streamState, refreshPlaybackContext }),
    )

    await expect(promise).rejects.toMatchObject({ code: Code.OPERATION_ABORTED })
    await expect(promise.catch((error) => error.code)).resolves.not.toBe(Code.BAD_HTTP_STATUS)
    expect(refreshPlaybackContext).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith('reload')
  })

  it('mints a new token when the stream protection status rejects it', async () => {
    fetch
      .mockResolvedValueOnce(makeResponse(200, [statusPart(3)]))
      .mockResolvedValueOnce(SUCCESS())
    const emit = vi.fn()
    const refreshPlaybackContext = vi.fn().mockResolvedValue(REFRESHED_PLAYBACK)
    const currentState = makeCurrentState({ emit, refreshPlaybackContext })

    const result = await doRequest(makeOperationInputs(), currentState)

    expect(result.status).toBe(200)
    expect(refreshPlaybackContext).toHaveBeenCalledWith({
      reloadPlaybackContext: undefined,
      tokenIsInvalid: true,
      renewToken: false,
    })
    const body = VideoPlaybackAbrRequest.decode(currentState.requestInit.body)
    expect(body.streamerContext.poToken).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('recovers once from a SABR error part', async () => {
    fetch
      .mockResolvedValueOnce(makeResponse(200, [sabrErrorPart()]))
      .mockResolvedValueOnce(SUCCESS())
    const refreshPlaybackContext = vi.fn().mockResolvedValue(REFRESHED_PLAYBACK)

    const result = await doRequest(
      makeOperationInputs(),
      makeCurrentState({ refreshPlaybackContext }),
    )

    expect(result.status).toBe(200)
    expect(refreshPlaybackContext).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('requests a view reload after repeated backoffs', async () => {
    fetch.mockResolvedValue(SUCCESS())
    const emit = vi.fn()
    const currentState = makeCurrentState({ emit })
    currentState.sabrStreamState.nextRequestPolicy = { backoffTimeMs: 1 }
    currentState.cumulativeBackOffRequested = 2

    await expect(doRequest(makeOperationInputs(), currentState))
      .rejects.toMatchObject({ code: Code.OPERATION_ABORTED })

    expect(emit).toHaveBeenCalledWith('reload')
  })
})
