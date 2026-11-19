import { describe, it, expect, vi } from 'vitest'
import { withAuth } from './auth-store.js'
import { createSimpleAuth } from './auth-builtin.js'
import { createTestStore } from './test-utils.js'

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

  it('denies updateField when can() returns false', async () => {
    const auth = createSimpleAuth()
    const session = await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    const { store, api } = createTestStore()
    auth.can = async () => false
    const wrapped = withAuth(store, auth, () => Promise.resolve(session.identity))
    await wrapped.fetch()

    const result = await wrapped.updateField('1', 'name', 'Hacked')

    expect(result).toBeUndefined()
    expect(store.error).toContain('Access denied')
    // The underlying mutation must never run when policy denies it.
    expect(store.items[0]?.name).not.toBe('Hacked')
  })

  it('allows updateField when can() returns true', async () => {
    const auth = createSimpleAuth()
    const session = await auth.register({ email: 'a@b.com', password: 'StrongPass1!' })
    const { store } = createTestStore([{ id: '1', name: 'Alice' }])
    const wrapped = withAuth(store, auth, () => Promise.resolve(session.identity))
    await wrapped.fetch()

    const result = await wrapped.updateField('1', 'name', 'Bob')

    expect(result?.name).toBe('Bob')
    expect(store.items[0]?.name).toBe('Bob')
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
