/**
 * Token store backed by a callback (e.g. a Zustand persist store).
 * Not exported; consumers use `createTokenManager` which accepts
 * synchronous get/set functions so it works with any state container.
 */

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface TokenManagerOptions {
  /** Get the current token pair synchronously (e.g. from zustand store). */
  getTokens: () => TokenPair | null

  /** Persist new tokens (called after a successful refresh). */
  setTokens: (tokens: TokenPair) => void

  /** Clear tokens on logout or refresh failure. */
  clearTokens: () => void

  /**
   * Async function that calls your refresh endpoint.
   * Should return a new `TokenPair`.
   */
  refresh: (refreshToken: string) => Promise<TokenPair>

  /**
   * Called before the access token expires.
   * Return `true` if the token is still valid.
   * @default expiry check (access token is a JWT with `exp` claim)
   */
  isExpired?: (token: string) => boolean

  /**
   * Buffer (ms) before actual expiry to trigger a proactive refresh.
   * @default 30000
   */
  refreshBufferMs?: number
}

export interface TokenManager {
  /** Get a valid access token, refreshing if necessary. */
  getAccessToken: () => Promise<string>

  /** Force a refresh immediately. */
  refreshNow: () => Promise<void>

  /** Invalidate tokens (logout). */
  invalidate: () => void

  /** Subscribe to token expiry/refresh events. */
  onStatusChange: (cb: (status: 'valid' | 'refreshing' | 'expired') => void) => () => void
}

/**
 * Lightweight approach: decode the JWT to extract `exp`, and
 * proactively refresh before the token expires.
 */
function defaultIsExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!))
    return Date.now() >= (payload.exp * 1000)
  } catch {
    return true // can't parse → treat as expired
  }
}

export function createTokenManager(options: TokenManagerOptions): TokenManager {
  const {
    getTokens,
    setTokens,
    clearTokens,
    refresh,
    isExpired = defaultIsExpired,
    refreshBufferMs = 30_000,
  } = options

  let refreshPromise: Promise<void> | null = null
  let cancelled = false
  let statusListeners: Array<(status: 'valid' | 'refreshing' | 'expired') => void> = []

  function notify(status: 'valid' | 'refreshing' | 'expired') {
    for (const cb of [...statusListeners]) cb(status)
  }

  async function getAccessToken(): Promise<string> {
    const pair = getTokens()
    if (!pair) throw new Error('No tokens available')

    // Check if token needs refresh
    const expiresSoon = isExpired(pair.accessToken) ||
      jwtExpiresWithin(pair.accessToken, refreshBufferMs)

    if (!expiresSoon) return pair.accessToken

    return refreshNow().then(() => {
      const refreshed = getTokens()
      if (!refreshed) throw new Error('Token refresh failed')
      return refreshed.accessToken
    })
  }

  async function refreshNow(): Promise<void> {
    // Deduplicate concurrent refresh calls
    if (refreshPromise) return refreshPromise

    refreshPromise = (async () => {
      notify('refreshing')
      const pair = getTokens()
      if (!pair?.refreshToken) {
        clearTokens()
        notify('expired')
        throw new Error('No refresh token available')
      }

      try {
        const newTokens = await refresh(pair.refreshToken)
        if (cancelled) return
        setTokens(newTokens)
        notify('valid')
      } catch {
        clearTokens()
        notify('expired')
        throw new Error('Token refresh failed')
      }
    })()

    try {
      await refreshPromise
    } finally {
      refreshPromise = null
    }
  }

  function invalidate() {
    cancelled = true
    clearTokens()
    notify('expired')
  }

  function onStatusChange(cb: (status: 'valid' | 'refreshing' | 'expired') => void): () => void {
    statusListeners.push(cb)
    return () => {
      statusListeners = statusListeners.filter((l) => l !== cb)
    }
  }

  return { getAccessToken, refreshNow, invalidate, onStatusChange }
}

/** Check whether a JWT's `exp` claim is within `bufferMs` of expiring. */
function jwtExpiresWithin(token: string, bufferMs: number): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!))
    const expMs = (payload.exp as number) * 1000
    return Date.now() + bufferMs >= expMs
  } catch {
    return true
  }
}
