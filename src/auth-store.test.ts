import { describe, it, expect, vi } from 'vitest'
import { withAuth } from './auth-store'
import { createSimpleAuth } from './auth-builtin'
import { createTestStore } from './test-utils'

describe('withAuth', () => {
  it('allows mutation when can() returns true', async () => {
    const auth = createSimpleAuth()
    const session = await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    const { store } = createTestStore()
    const wrapped = withAuth(store, auth, () => Promise.resolve(session.identity))
    await wrapped.fetch()
    const result = await wrapped.create({ name: 'test', foo: 'bar' } as any)
    expect(result).toBeTruthy()
  })

  it('denies mutation when can() returns false', async () => {
    const auth = createSimpleAuth()
    const session = await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    const { store } = createTestStore()
    // Mock can to deny
    const origCan = auth.can.bind(auth)
    auth.can = async () => false
    const wrapped = withAuth(store, auth, () => Promise.resolve(session.identity))
    await wrapped.fetch()
    const result = await wrapped.create({ name: 'test', foo: 'bar' } as any)
    // Should return error rather than throw
    expect(result).toBeUndefined()  // create returns the entity on success, errors are in store.error
    expect(store.error).toContain('denied')  // or similar
  })

  it('denies mutation when not authenticated', async () => {
    const auth = createSimpleAuth()
    const { store } = createTestStore()
    const wrapped = withAuth(store, auth, () => Promise.resolve(null))
    await wrapped.fetch()
    await wrapped.create({ name: 'test' } as any)
    expect(store.error).toBeTruthy()
  })

  it('emits auth:denied event on denial', async () => {
    const auth = createSimpleAuth()
    const session = await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    const { store } = createTestStore()
    auth.can = async () => false
    const events: any[] = []
    auth.on('auth:denied', (e) => events.push(e))
    const wrapped = withAuth(store, auth, () => Promise.resolve(session.identity))
    await wrapped.fetch()
    await wrapped.create({ name: 'test' } as any)
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].action).toBe('create')
  })
})
