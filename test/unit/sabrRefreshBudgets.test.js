import { describe, expect, it, vi } from 'vitest'

import {
  applyRefreshedPlayback,
  createRefreshBudget,
  recordHealthyPlaybackTime,
  refreshPlaybackInSession,
} from '../../src/renderer/helpers/player/SabrSchemePlugin.js'
import { makeCurrentState, makeSabrStreamState, REFRESHED_PLAYBACK } from '../helpers/sabr.js'

describe('refresh budgets', () => {
  it('starts full', () => {
    expect(createRefreshBudget(3)).toEqual({ max: 3, available: 3 })
  })

  it('earns one credit per 60 seconds of healthy playback in every budget', () => {
    const streamState = makeSabrStreamState({
      lastHealthyPlaybackAt: 1_000,
      healthyPlaybackTimeMs: 0,
      reloadRefreshBudget: { max: 3, available: 0 },
      forbiddenRefreshBudget: { max: 2, available: 0 },
      sabrErrorRefreshBudget: { max: 1, available: 0 },
    })

    recordHealthyPlaybackTime(streamState, 31_000)
    recordHealthyPlaybackTime(streamState, 61_000)

    expect(streamState.reloadRefreshBudget.available).toBe(1)
    expect(streamState.forbiddenRefreshBudget.available).toBe(1)
    expect(streamState.sabrErrorRefreshBudget.available).toBe(1)
    expect(streamState.healthyPlaybackTimeMs).toBe(0)
  })

  it('accumulates smaller gaps until a full interval is reached', () => {
    const streamState = makeSabrStreamState({
      lastHealthyPlaybackAt: 0,
      reloadRefreshBudget: { max: 3, available: 0 },
      forbiddenRefreshBudget: { max: 2, available: 0 },
      sabrErrorRefreshBudget: { max: 1, available: 0 },
    })

    recordHealthyPlaybackTime(streamState, 20_000)
    recordHealthyPlaybackTime(streamState, 40_000)
    expect(streamState.reloadRefreshBudget.available).toBe(0)
    expect(streamState.healthyPlaybackTimeMs).toBe(40_000)

    recordHealthyPlaybackTime(streamState, 60_000)
    expect(streamState.reloadRefreshBudget.available).toBe(1)
  })

  it('does not earn credits across a playback gap longer than 30 seconds', () => {
    const streamState = makeSabrStreamState({
      lastHealthyPlaybackAt: 1_000,
      reloadRefreshBudget: { max: 3, available: 0 },
      forbiddenRefreshBudget: { max: 2, available: 0 },
      sabrErrorRefreshBudget: { max: 1, available: 0 },
    })

    recordHealthyPlaybackTime(streamState, 32_000)

    expect(streamState.reloadRefreshBudget.available).toBe(0)
    expect(streamState.healthyPlaybackTimeMs).toBe(0)
    expect(streamState.lastHealthyPlaybackAt).toBe(32_000)
  })

  it('never earns past the budget maximum', () => {
    const streamState = makeSabrStreamState({
      lastHealthyPlaybackAt: 0,
      forbiddenRefreshBudget: { max: 2, available: 1 },
    })

    recordHealthyPlaybackTime(streamState, 20_000)
    recordHealthyPlaybackTime(streamState, 40_000)
    recordHealthyPlaybackTime(streamState, 60_000)
    recordHealthyPlaybackTime(streamState, 80_000)

    expect(streamState.forbiddenRefreshBudget.available).toBe(2)
  })
})

describe('applyRefreshedPlayback', () => {
  it('installs the new session and clears stale backoff state', () => {
    const streamState = makeSabrStreamState({
      nextRequestPolicy: { backoffTimeMs: 5_000, playbackCookie: { data: 'cookie' } },
    })
    const currentState = makeCurrentState({ sabrStreamState: streamState })
    currentState.cumulativeBackOffRequested = 3
    currentState.cumulativeBackOffTimeMs = 9_000
    currentState.abrRequest.streamerContext.backoffTimeMs = 5_000

    applyRefreshedPlayback(currentState, REFRESHED_PLAYBACK)

    expect(currentState.sabrStreamState.sabrUrl).toBe(REFRESHED_PLAYBACK.url)
    expect(currentState.sabrStreamState.poToken).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(currentState.abrRequest.streamerContext.poToken).toEqual(currentState.sabrStreamState.poToken)
    expect(currentState.abrRequest.videoPlaybackUstreamerConfig).toEqual(new Uint8Array([0, 0, 0]))
    expect(currentState.cumulativeBackOffRequested).toBe(0)
    expect(currentState.cumulativeBackOffTimeMs).toBe(0)
    expect(streamState.nextRequestPolicy.backoffTimeMs).toBe(0)
    expect(streamState.nextRequestPolicy.playbackCookie).toEqual({ data: 'cookie' })
    expect(currentState.abrRequest.streamerContext.backoffTimeMs).toBeUndefined()
  })
})

describe('refreshPlaybackInSession', () => {
  it('returns null when no refresh callback is wired up', async () => {
    await expect(refreshPlaybackInSession(makeCurrentState(), 'forbidden')).resolves.toBeNull()
  })

  it.each([
    ['reload', { reloadPlaybackContext: { token: 'abc' }, tokenIsInvalid: false, renewToken: false }],
    ['forbidden', { reloadPlaybackContext: undefined, tokenIsInvalid: false, renewToken: true }],
    ['invalidPoToken', { reloadPlaybackContext: undefined, tokenIsInvalid: true, renewToken: false }],
    ['sabrError', { reloadPlaybackContext: undefined, tokenIsInvalid: false, renewToken: false }],
  ])('passes the right options for the %s reason', async (reason, expected) => {
    const refreshPlaybackContext = vi.fn().mockResolvedValue(REFRESHED_PLAYBACK)
    const reloadContext = { token: 'abc' }

    const result = await refreshPlaybackInSession(
      makeCurrentState({ refreshPlaybackContext }),
      reason,
      reloadContext,
    )

    expect(result).toEqual(REFRESHED_PLAYBACK)
    expect(refreshPlaybackContext).toHaveBeenCalledWith(expected)
  })

  it('does not call the refresh when the matching budget is empty', async () => {
    const streamState = makeSabrStreamState({
      forbiddenRefreshBudget: { max: 2, available: 0 },
    })
    const refreshPlaybackContext = vi.fn().mockResolvedValue(REFRESHED_PLAYBACK)

    const result = await refreshPlaybackInSession(
      makeCurrentState({ sabrStreamState: streamState, refreshPlaybackContext }),
      'forbidden',
    )

    expect(result).toBeNull()
    expect(refreshPlaybackContext).not.toHaveBeenCalled()
  })

  it('spends one credit per refresh and shares an in-flight refresh', async () => {
    let resolveRefresh
    const refreshPlaybackContext = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve
    }))
    const streamState = makeSabrStreamState()
    const currentState = makeCurrentState({ sabrStreamState: streamState, refreshPlaybackContext })

    const first = refreshPlaybackInSession(currentState, 'reload')
    const second = refreshPlaybackInSession(currentState, 'reload')

    expect(refreshPlaybackContext).toHaveBeenCalledTimes(1)
    expect(streamState.reloadRefreshBudget.available).toBe(2)

    resolveRefresh(REFRESHED_PLAYBACK)
    await expect(first).resolves.toEqual(REFRESHED_PLAYBACK)
    await expect(second).resolves.toEqual(REFRESHED_PLAYBACK)
    expect(streamState.pendingRefresh).toBeNull()
  })

  it('turns a refresh failure into null', async () => {
    const refreshPlaybackContext = vi.fn().mockRejectedValue(new Error('network down'))

    await expect(refreshPlaybackInSession(
      makeCurrentState({ refreshPlaybackContext }),
      'forbidden',
    )).resolves.toBeNull()
  })
})
