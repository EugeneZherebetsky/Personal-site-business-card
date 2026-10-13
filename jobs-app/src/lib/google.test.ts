import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearGoogleAccess,
  forgetGoogleScope,
  GMAIL_METADATA_SCOPE,
  GoogleResponseError,
  GoogleScopeError,
  hasGoogleAccess,
  isGoogleRefusal,
  isTerminalClientError,
  REQUIRED_GOOGLE_SCOPES,
  requestGoogleAccess,
} from './google'

describe('isGoogleRefusal', () => {
  it('recognises any answer from Google, and nothing else', () => {
    expect(isGoogleRefusal(new GoogleResponseError('refused', 400))).toBe(true)
    expect(isGoogleRefusal(new GoogleResponseError('server error', 503))).toBe(true)
    expect(isGoogleRefusal(new Error('network down'))).toBe(false)
    expect(isGoogleRefusal(null)).toBe(false)
  })
})

describe('isTerminalClientError', () => {
  it('treats client rejections as proof that nothing was delivered', () => {
    for (const status of [400, 401, 403, 404, 413, 422, 429]) {
      expect(isTerminalClientError(new GoogleResponseError('rejected', status))).toBe(true)
    }
  })

  it('never treats a server failure as proof, because Gmail can fail after accepting', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isTerminalClientError(new GoogleResponseError('server error', status))).toBe(false)
    }
  })

  it('treats a request timeout as unknown rather than refused', () => {
    expect(isTerminalClientError(new GoogleResponseError('timeout', 408))).toBe(false)
  })

  it('treats a transport failure as unknown', () => {
    expect(isTerminalClientError(new Error('Failed to fetch'))).toBe(false)
  })
})

describe('requestGoogleAccess scope tracking', () => {
  const USER = 'user-1'
  const CLIENT = '123456-abc.apps.googleusercontent.com'
  const PARTIAL = REQUIRED_GOOGLE_SCOPES.join(' ')
  const FULL = [...REQUIRED_GOOGLE_SCOPES, GMAIL_METADATA_SCOPE].join(' ')

  let grants: string[] = []
  const initTokenClient = vi.fn(
    (config: {
      callback: (response: { access_token?: string; expires_in?: number; scope?: string }) => void
    }) => ({
      requestAccessToken: () => {
        const scope = grants.shift() ?? FULL
        config.callback({
          access_token: `token-${initTokenClient.mock.calls.length}`,
          expires_in: 3600,
          scope,
        })
      },
    }),
  )

  beforeEach(() => {
    clearGoogleAccess()
    grants = []
    initTokenClient.mockClear()
    window.google = { accounts: { oauth2: { initTokenClient } } }
  })

  afterEach(() => {
    delete window.google
  })

  it('reuses a partial token for sending, but asks again before a reply check', async () => {
    grants = [PARTIAL, FULL]
    await expect(requestGoogleAccess(USER, CLIENT)).resolves.toBe('token-1')
    await expect(requestGoogleAccess(USER, CLIENT)).resolves.toBe('token-1')
    expect(initTokenClient).toHaveBeenCalledTimes(1)

    await expect(
      requestGoogleAccess(USER, CLIENT, { needs: [GMAIL_METADATA_SCOPE] }),
    ).resolves.toBe('token-2')
    expect(initTokenClient).toHaveBeenCalledTimes(2)
    expect(hasGoogleAccess(USER, CLIENT, [GMAIL_METADATA_SCOPE])).toBe(true)
  })

  it('keeps the partial token for sending when header access is declined again', async () => {
    grants = [PARTIAL]
    await expect(
      requestGoogleAccess(USER, CLIENT, { needs: [GMAIL_METADATA_SCOPE] }),
    ).rejects.toBeInstanceOf(GoogleScopeError)
    expect(hasGoogleAccess(USER, CLIENT)).toBe(true)
    expect(hasGoogleAccess(USER, CLIENT, [GMAIL_METADATA_SCOPE])).toBe(false)
    await expect(requestGoogleAccess(USER, CLIENT)).resolves.toBe('token-1')
    expect(initTokenClient).toHaveBeenCalledTimes(1)
  })

  it('asks again after Gmail refuses a read on a token that claimed header access', async () => {
    await requestGoogleAccess(USER, CLIENT, { needs: [GMAIL_METADATA_SCOPE] })
    forgetGoogleScope(GMAIL_METADATA_SCOPE)
    await requestGoogleAccess(USER, CLIENT, { needs: [GMAIL_METADATA_SCOPE] })
    expect(initTokenClient).toHaveBeenCalledTimes(2)
  })

  it('still refuses a connection without Calendar and send', async () => {
    grants = [GMAIL_METADATA_SCOPE]
    await expect(requestGoogleAccess(USER, CLIENT)).rejects.toThrow(
      'Calendar and Gmail permissions are both required',
    )
    expect(hasGoogleAccess(USER, CLIENT)).toBe(false)
  })
})
