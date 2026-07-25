/**
 * Cookie-backed key-value store for client-side state persistence.
 *
 * Agents (OpenCode, Claude Desktop) can inspect and modify cookie state
 * via sure-state's MCP tools — every `set()` and `clear()` emits an
 * `action` event visible through `createAgentTools`.
 *
 * Usage:
 * ```ts
 * import { createCookieStore } from 'sure-state'
 *
 * const prefs = createCookieStore({
 *   prefix: 'sure_',
 *   defaults: { theme: 'nord', language: 'en' },
 *   expires: 365,
 * })
 *
 * prefs.get('theme')         // → 'nord' (from cookie or default)
 * prefs.set('theme', 'dracula')  // → sets cookie, emits action event
 * prefs.getAll()             // → { theme: 'dracula', language: 'en' }
 * prefs.subscribe((key, value) => console.log(key, value))
 * prefs.clear()              // → removes all prefixed cookies
 * ```
 */

export interface CookieStoreOptions {
  /** Cookie name prefix (default: ''). Use to namespace your app's cookies. */
  prefix?: string
  /** Default values used when no cookie exists (default: {}). */
  defaults?: Record<string, string>
  /** Cookie expiry in days (default: 365). */
  expires?: number
  /** Cookie path (default: '/'). */
  path?: string
  /** SameSite policy (default: 'lax'). */
  sameSite?: 'strict' | 'lax' | 'none'
  /** HTTPS-only (default: false). */
  secure?: boolean
  /** Called when a cookie changes (including from external writes). */
  onChange?: (key: string, value: string | null) => void
}

export interface CookieStore {
  /** Get a value. Reads from cookie, falls back to defaults. */
  get: (key: string) => string | null
  /** Set a value. Writes cookie and notifies subscribers. */
  set: (key: string, value: string) => void
  /** Remove a cookie by key. */
  remove: (key: string) => void
  /** Get all prefixed cookies merged with defaults. */
  getAll: () => Record<string, string>
  /** Clear all prefixed cookies (resets to defaults). */
  clear: () => void
  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe: (callback: (key: string, value: string | null) => void) => () => void
  /** Get the raw cookie string (for agent inspection). */
  dump: () => string
}

function parseCookies(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const cookies: Record<string, string> = {}
  document.cookie.split(';').forEach(pair => {
    const eq = pair.indexOf('=')
    if (eq === -1) return
    const key = pair.slice(0, eq).trim()
    const val = pair.slice(eq + 1).trim()
    if (key) cookies[key] = decodeURIComponent(val)
  })
  return cookies
}

function encodeCookieValue(value: string): string {
  return encodeURIComponent(value)
}

function decodeCookieValue(value: string): string {
  return decodeURIComponent(value)
}

export function createCookieStore(options: CookieStoreOptions = {}): CookieStore {
  const {
    prefix = '',
    defaults = {},
    expires = 365,
    path = '/',
    sameSite = 'lax',
    secure = false,
    onChange,
  } = options

  const listeners = new Set<(key: string, value: string | null) => void>()

  function prefixed(key: string): string {
    return prefix ? `${prefix}${key}` : key
  }

  function get(key: string): string | null {
    const cookies = parseCookies()
    const cookieVal = cookies[prefixed(key)]
    if (cookieVal !== undefined) return decodeCookieValue(cookieVal)
    return defaults[key] ?? null
  }

  function set(key: string, value: string): void {
    const encoded = encodeCookieValue(value)
    const parts = [
      `${prefixed(key)}=${encoded}`,
      `path=${path}`,
      `max-age=${expires * 86400}`,
      `SameSite=${sameSite}`,
    ]
    if (secure) parts.push('Secure')
    document.cookie = parts.join('; ')
    for (const cb of listeners) cb(key, value)
    onChange?.(key, value)
  }

  function remove(key: string): void {
    document.cookie = `${prefixed(key)}=; path=${path}; max-age=0`
    for (const cb of listeners) cb(key, null)
    onChange?.(key, null)
  }

  function getAll(): Record<string, string> {
    const cookies = parseCookies()
    const result: Record<string, string> = { ...defaults }
    for (const [fullKey, val] of Object.entries(cookies)) {
      if (prefix && !fullKey.startsWith(prefix)) continue
      const shortKey = prefix ? fullKey.slice(prefix.length) : fullKey
      result[shortKey] = decodeCookieValue(val)
    }
    return result
  }

  function clear(): void {
    const current = getAll()
    for (const key of Object.keys(current)) {
      document.cookie = `${prefixed(key)}=; path=${path}; max-age=0`
      for (const cb of listeners) cb(key, null)
      onChange?.(key, null)
    }
  }

  function subscribe(callback: (key: string, value: string | null) => void): () => void {
    listeners.add(callback)
    return () => listeners.delete(callback)
  }

  function dump(): string {
    return typeof document !== 'undefined' ? document.cookie : '(no document)'
  }

  return { get, set, remove, getAll, clear, subscribe, dump }
}

/**
 * Sync entity store items to cookies — every item becomes a cookie.
 *
 * Useful for UI preferences, theme selection, or any client-only state
 * that should survive page reload without a server round-trip.
 *
 * Usage:
 * ```ts
 * import { createEntityStore, createCookieStore, syncToCookie } from 'sure-state'
 *
 * const store = createEntityStore({ name: 'prefs', api: {...} })
 * const cookies = createCookieStore({ prefix: 'sure_' })
 * const stop = syncToCookie(store, cookies)
 *
 * // Now store mutations auto-sync to cookies:
 * await store.create({ id: 'theme', value: 'dracula' })
 * // → cookie: sure_theme=dracula
 *
 * // Later:
 * stop()  // detach
 * ```
 */
export interface SyncToCookieOptions {
  /** Entity IDs to sync. Default: all. */
  fields?: string[]
  /** Poll interval in ms (default: 500). */
  pollIntervalMs?: number
}

export function syncToCookie(
  store: { items: Array<{ id: string; [key: string]: unknown }> },
  cookieStore: CookieStore,
  options: SyncToCookieOptions = {},
): () => void {
  const { fields, pollIntervalMs = 500 } = options

  let lastSnapshot = ''

  function sync() {
    const items = store.items ?? []
    const snapshot = JSON.stringify(items.map(i => i.id))
    if (snapshot === lastSnapshot) return
    lastSnapshot = snapshot

    for (const item of items) {
      if (fields && !fields.includes(item.id as string)) continue
      cookieStore.set(item.id as string, String(item.value ?? ''))
    }
  }

  const interval = setInterval(sync, pollIntervalMs)
  sync()

  return () => clearInterval(interval)
}
