import { describe, it, expect } from 'vitest'
import { createSimpleAuth } from './auth-builtin'

describe('createSimpleAuth', () => {
  it('registers a user and logs in', async () => {
    const auth = createSimpleAuth()
    const session = await auth.register({ email: 'test@example.com', password: 'StrongPass1!' })
    expect(session.identity.id).toBeTruthy()
    expect(session.identity.roles).toContain('user')
    expect(session.token).toBeTruthy()
    expect(session.expiresAt).toBeGreaterThan(Date.now())
  })

  it('logs in with correct credentials', async () => {
    const auth = createSimpleAuth()
    await auth.register({ email: 'user@test.com', password: 'StrongPass1!' })
    const session = await auth.login({ email: 'user@test.com', password: 'StrongPass1!' })
    expect(session.identity.id).toBeTruthy()
  })

  it('rejects wrong password', async () => {
    const auth = createSimpleAuth()
    await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    await expect(auth.login({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow('Invalid credentials')
  })

  it('rejects weak password on register', async () => {
    const auth = createSimpleAuth()
    await expect(auth.register({ email: 'a@b.com', password: 'short' })).rejects.toThrow('Password')
  })

  it('getSession returns null for invalid token', async () => {
    const auth = createSimpleAuth()
    const session = await auth.getSession('invalid-token')
    expect(session).toBeNull()
  })

  it('getSession returns session for valid token', async () => {
    const auth = createSimpleAuth()
    const s = await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    const got = await auth.getSession(s.token)
    expect(got).not.toBeNull()
    expect(got!.identity.id).toBe(s.identity.id)
  })

  it('logout invalidates session', async () => {
    const auth = createSimpleAuth()
    const s = await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    await auth.logout(s.token)
    const got = await auth.getSession(s.token)
    expect(got).toBeNull()
  })

  it('rate limits after max failed attempts', async () => {
    const auth = createSimpleAuth({ rateLimit: { maxAttempts: 3, windowMs: 60000, banMs: 60000 } })
    await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    for (let i = 0; i < 3; i++) {
      await expect(auth.login({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow()
    }
    await expect(auth.login({ email: 'a@b.com', password: 'StrongPass1!' })).rejects.toThrow('locked')
  })

  it('emits auth events', async () => {
    const auth = createSimpleAuth()
    const events: string[] = []
    auth.on('auth:login', () => events.push('login'))
    auth.on('auth:failed', () => events.push('failed'))
    auth.on('auth:register', () => events.push('register'))
    await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    await auth.login({ email: 'a@b.com', password: 'StrongPass1!' })
    await expect(auth.login({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow()
    expect(events).toContain('register')
    expect(events).toContain('login')
    expect(events).toContain('failed')
  })

  it('authenticate returns identity for valid token', async () => {
    const auth = createSimpleAuth()
    const s = await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    const identity = await auth.authenticate(s.token)
    expect(identity).not.toBeNull()
    expect(identity!.id).toBe(s.identity.id)
  })

  it('authenticate returns null for expired token', async () => {
    const auth = createSimpleAuth({ sessions: { maxAgeMs: -1 } })
    const s = await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    const identity = await auth.authenticate(s.token)
    expect(identity).toBeNull()
  })
})
