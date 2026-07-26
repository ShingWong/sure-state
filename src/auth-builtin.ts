import { randomUUID, scryptSync, timingSafeEqual } from 'crypto'
import type { Identity, Session, SessionStore, AuthAdapter, AuthEventType, AuthEventPayload } from './auth-types'

export interface SimpleAuthOptions {
  sessions?: {
    store?: SessionStore
    maxAgeMs?: number
  }
  passwordPolicy?: {
    minLength?: number
    requireUpper?: boolean
    requireDigit?: boolean
    requireSpecial?: boolean
  }
  rateLimit?: {
    maxAttempts?: number
    windowMs?: number
    banMs?: number
  }
  cookies?: {
    name?: string
    path?: string
    secure?: boolean
  }
}

class MemorySessionStore implements SessionStore {
  private store = new Map<string, Session>()
  async get(token: string) { return this.store.get(token) }
  async set(token: string, session: Session) { this.store.set(token, session) }
  async delete(token: string) { this.store.delete(token) }
  async cleanup() {
    const now = Date.now()
    let count = 0
    for (const [k, v] of this.store) {
      if (v.expiresAt <= now) { this.store.delete(k); count++ }
    }
    return count
  }
}

function hashPassword(password: string): string {
  const salt = randomUUID()
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  const derived = scryptSync(password, salt!, 64).toString('hex')
  if (derived.length !== hash!.length) return false
  return timingSafeEqual(Buffer.from(derived), Buffer.from(hash!))
}

export function createSimpleAuth(options: SimpleAuthOptions = {}): AuthAdapter {
  const maxAgeMs = options.sessions?.maxAgeMs ?? 86400_000  // 24h
  const sessionStore = options.sessions?.store ?? new MemorySessionStore()
  const minLength = options.passwordPolicy?.minLength ?? 8
  const requireUpper = options.passwordPolicy?.requireUpper ?? true
  const requireDigit = options.passwordPolicy?.requireDigit ?? true
  const requireSpecial = options.passwordPolicy?.requireSpecial ?? false
  const maxAttempts = options.rateLimit?.maxAttempts ?? 5
  const windowMs = options.rateLimit?.windowMs ?? 300_000  // 5 min
  const banMs = options.rateLimit?.banMs ?? 300_000

  // In-memory user store
  const users = new Map<string, { id: string; email: string; passwordHash: string; roles: string[] }>()
  // Rate limit store: key (email or ip) → { attempts: number[], bannedUntil: number }
  const rateLimitStore = new Map<string, { attempts: number[]; bannedUntil: number }>()

  const listeners = new Map<string, Set<Function>>()

  function emit<E extends AuthEventType>(event: E, payload: AuthEventPayload[E]) {
    const handlers = listeners.get(event)
    if (handlers) for (const h of handlers) h(payload)
  }

  function on<E extends AuthEventType>(event: E, handler: (payload: AuthEventPayload[E]) => void): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(handler)
    return () => listeners.get(event)?.delete(handler)
  }

  function checkRateLimit(key: string): void {
    const now = Date.now()
    const entry = rateLimitStore.get(key) || { attempts: [], bannedUntil: 0 }
    if (entry.bannedUntil > now) throw new Error('Account temporarily locked. Try again later.')
    // Clean old attempts
    entry.attempts = entry.attempts.filter(t => now - t < windowMs)
    entry.attempts.push(now)
    if (entry.attempts.length > maxAttempts) {
      entry.bannedUntil = now + banMs
      rateLimitStore.set(key, entry)
      throw new Error('Account temporarily locked. Try again later.')
    }
    rateLimitStore.set(key, entry)
  }

  function validatePassword(password: string): void {
    if (password.length < minLength) throw new Error(`Password must be at least ${minLength} characters`)
    if (requireUpper && !/[A-Z]/.test(password)) throw new Error('Password must contain an uppercase letter')
    if (requireDigit && !/\d/.test(password)) throw new Error('Password must contain a digit')
    if (requireSpecial && !/[^a-zA-Z0-9]/.test(password)) throw new Error('Password must contain a special character')
  }

  async function login(credentials: Record<string, string>): Promise<Session> {
    const email = credentials.email?.toLowerCase().trim()
    const password = credentials.password || ''
    if (!email) throw new Error('Email is required')
    checkRateLimit(email)
    const user = users.get(email)
    if (!user || !verifyPassword(password, user.passwordHash)) {
      const entry = rateLimitStore.get(email)
      emit('auth:failed', { email, reason: 'Invalid credentials', consecutiveFailures: entry?.attempts.length ?? 1, timestamp: Date.now() })
      throw new Error('Invalid credentials')
    }
    const token = randomUUID()
    const identity: Identity = { id: user.id, roles: [...user.roles], metadata: { email: user.email } }
    const session: Session = { identity, token, expiresAt: Date.now() + maxAgeMs }
    await sessionStore.set(token, session)
    emit('auth:login', { identity, timestamp: Date.now() })
    return session
  }

  async function register(credentials: Record<string, string>): Promise<Session> {
    const email = credentials.email?.toLowerCase().trim()
    const password = credentials.password || ''
    if (!email) throw new Error('Email is required')
    if (users.has(email)) throw new Error('Email already registered')
    validatePassword(password)
    const id = randomUUID()
    users.set(email, { id, email, passwordHash: hashPassword(password), roles: ['user'] })
    const token = randomUUID()
    const identity: Identity = { id, roles: ['user'], metadata: { email } }
    const session: Session = { identity, token, expiresAt: Date.now() + maxAgeMs }
    await sessionStore.set(token, session)
    emit('auth:register', { identity, timestamp: Date.now() })
    return session
  }

  async function logout(sessionToken: string): Promise<void> {
    const session = await sessionStore.get(sessionToken)
    await sessionStore.delete(sessionToken)
    if (session) emit('auth:logout', { identityId: session.identity.id, timestamp: Date.now() })
  }

  async function getSession(sessionToken: string): Promise<Session | null> {
    const session = await sessionStore.get(sessionToken)
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      await sessionStore.delete(sessionToken)
      emit('auth:session_expired', { token: sessionToken, timestamp: Date.now() })
      return null
    }
    return session
  }

  async function authenticate(token: string): Promise<Identity | null> {
    const session = await getSession(token)
    return session?.identity ?? null
  }

  async function can(identity: Identity, action: string, entity?: unknown): Promise<boolean> {
    if (identity.roles.includes('admin')) return true
    // Default: owner-only for write operations
    if (action === 'create' || action === 'update' || action === 'delete') {
      const entityObj = entity as Record<string, unknown> | undefined
      if (entityObj && entityObj.ownerId && entityObj.ownerId !== identity.id) return false
    }
    return true
  }

  return {
    name: 'builtin',
    login, register, logout, getSession, authenticate, can, on,
  }
}
