### Task 3: withAuth() store wrapper (`sure-state/src/auth-store.ts`)

**Files:**
- Create: `/usr/local/devel/sure-state/src/auth-store.ts`
- Create: `/usr/local/devel/sure-state/src/auth-store.test.ts`

**Interfaces:**
- Consumes: `AuthAdapter`, `Identity`, `EntityStore` from types
- Produces: `withAuth(store, adapter, getIdentity)` → wrapped EntityStore

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { withAuth } from './auth-store'
import { createSimpleAuth } from './auth-builtin'
import { createMockApi, createTestStore } from './test-utils'

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
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /usr/local/devel/sure-state && npx vitest run src/auth-store.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Write auth-store.ts**

```ts
import type { EntityStore } from './types'
import type { AuthAdapter, Identity } from './auth-types'

export function withAuth<T extends { id: string }, TCreate = Partial<T>, TUpdate = Partial<T>>(
  store: EntityStore<T, TCreate, TUpdate>,
  auth: AuthAdapter,
  getIdentity: () => Promise<Identity | null>,
): EntityStore<T, TCreate, TUpdate> {
  const wrapped = { ...store } as EntityStore<T, TCreate, TUpdate>

  async function check(action: string, entity?: unknown): Promise<boolean> {
    const identity = await getIdentity()
    if (!identity) {
      auth.emit?.('auth:unauthenticated' as any, { action, timestamp: Date.now() } as any)
      return false
    }
    const allowed = await auth.can(identity, action, entity)
    if (!allowed) {
      auth.emit?.('auth:denied' as any, {
        identity, action, entityType: (entity as any)?.id ? 'entity' : undefined,
        reason: 'Policy denied', timestamp: Date.now(),
      } as any)
    }
    return allowed
  }

  const origCreate = store.create.bind(store)
  wrapped.create = async (data: TCreate): Promise<T> => {
    if (!await check('create', data)) {
      const errStore = store as any
      if (errStore.setState) {
        errStore.setState({ error: 'Access denied: insufficient permissions', isLoading: false })
      }
      throw new Error('Access denied: insufficient permissions')
    }
    return origCreate(data)
  }

  const origUpdate = store.update.bind(store)
  wrapped.update = async (id: string, data: TUpdate): Promise<T> => {
    if (!await check('update', { id, ...data } as any)) {
      throw new Error('Access denied: insufficient permissions')
    }
    return origUpdate(id, data)
  }

  const origDelete = store.delete.bind(store)
  wrapped.delete = async (id: string): Promise<void> => {
    if (!await check('delete', { id })) {
      throw new Error('Access denied: insufficient permissions')
    }
    return origDelete(id)
  }

  return wrapped
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /usr/local/devel/sure-state && npx vitest run src/auth-store.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Update index.ts to export new modules**

```ts
// Add to src/index.ts exports
export { createSimpleAuth } from './auth-builtin'
export { withAuth } from './auth-store'
export type { AuthAdapter, Identity, Session, SessionStore, AuthEventType, AuthEventPayload, AuthEventHandler, SimpleAuthOptions } from './auth-types'
```

- [ ] **Step 6: Build and run all tests**

```bash
cd /usr/local/devel/sure-state && npm run build && npm test
```
Expected: Build OK, all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /usr/local/devel/sure-state && git add -A && git commit -m "feat: withAuth store wrapper for policy enforcement"
```

---

