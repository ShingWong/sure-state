# sure-state

**JavaEE reliability. JavaScript developer velocity.**

Write stateful apps with the consistency of managed beans and the ergonomics of React hooks. The server is always the source of truth — no guessing, no stale caches, no overwritten changes.

```
npm install sure-state
```

## Why?

Every non-trivial web app faces the same problem: the client has one version of the data, the server has another. Most state management libraries (Zustand, Redux, Jotai) handle **local** state beautifully but leave synchronization as an exercise for the developer. JavaEE handled this correctly — managed beans owned the state, transactions guaranteed consistency — but at the cost of heavy servers and slow iteration.

sure-state brings the same reliability model to modern TypeScript apps, with a single pattern:

1. **Fetch** data from the server into a typed store
2. **Mutate** via the store — it calls the API, then re-fetches to guarantee consistency
3. **Subscribe** to server-pushed updates via WebSocket for real-time sync
4. **Inspect** every action with built-in devtools, Prometheus metrics, and OpenTelemetry spans

## Philosophy

| Principle | Why |
|---|---|
| **Server is source of truth** | Local state is a cache, not authority. Every write re-fetches (or applies push events). |
| **Explicit sync strategy** | Choose `client-first` (optimistic, single-user) or `server-first` (pessimistic, collaborative). |
| **Zustand-native** | Uses Zustand under the hood. No new reactivity model to learn. |
| **Framework-agnostic** | Works with React, Vue, Svelte, or vanilla JS via Zustand's vanilla store. |
| **Real-time optional** | WebSocket integration is opt-in. Without it, the store still guarantees consistency via re-fetch. |

## Quick start

```ts
import { createEntityStore } from 'sure-state'
import { apiClient } from './your-api-client'

interface Persona {
  id: string
  name: string
  description: string | null
  isActive: boolean
}

const personaStore = createEntityStore<Persona>({
  name: 'persona',
  api: {
    list:    () => apiClient.get('/personas').then(r => r.data),
    getById: (id) => apiClient.get(`/personas/${id}`).then(r => r.data),
    create:  (data) => apiClient.post('/personas', data).then(r => r.data),
    update:  (id, data) => apiClient.put(`/personas/${id}`, data).then(r => r.data),
    remove:  (id) => apiClient.delete(`/personas/${id}`),
  },
})

// Use it
await personaStore.fetch()
console.log(personaStore.items)   // typed array
console.log(personaStore.isLoading)
console.log(personaStore.error)

await personaStore.create({ name: 'Support Bot', identity: 'You are helpful...' })
// After create: items list is refreshed from server

personaStore.select('abc-123')
console.log(personaStore.selected) // single entity or null
```

## Sync strategies

### `client-first` (default)

Optimistic local update + re-fetch. Use when the current user is the **only writer** of this data.

```
create → api.create(data) → prepend to local items → done
delete → api.remove(id)   → filter from local items → done
```

Fast UX. Safe for single-user apps (user owns their data).

### `server-first`

Always re-fetch after every mutation. Never trust local state after a write. Required when **multiple users or agents** can modify the same entities.

```
create → api.create(data) → re-fetch full list → done
delete → api.remove(id)   → re-fetch full list → done
```

Slower per-mutation but guarantees consistency. Required for collaborative multi-user apps.

## Real-time sync (WebSocket)

```ts
import { createEntityStore, createWebSocketClient } from 'sure-state'

const ws = createWebSocketClient({
  url: 'wss://api.example.com/ws',
  getToken: () => localStorage.getItem('access_token'),
})

const personaStore = createEntityStore<Persona>({
  name: 'persona',
  api: { /* ... */ },
  onSubscribe: (handler) => ws.subscribe('persona', handler),
})
```

When the server pushes a `{ type: 'updated', entityType: 'persona', entity: {...} }` event, the store automatically patches its local items array.

## Version stamps (optimistic concurrency)

When multiple writers can race on the same entity (user edits a persona while an agent updates its context), use version stamps:

```ts
import { stampFor, ConflictError } from 'sure-state'

// Client side:
const stamp = stampFor(existingPersona)
await api.update(id, { ...changes, ...stamp })

// Server side (SQL example):
const result = await sql`
  UPDATE "Persona" SET name = ${name}, version = version + 1
  WHERE id = ${id} AND version = ${stamp.version}
  RETURNING *
`
if (result.length === 0) throw new ConflictError('Persona')
```

## Token management

```ts
import { createTokenManager } from 'sure-state'

const tokenManager = createTokenManager({
  getTokens:    () => authStore.getState().tokens,
  setTokens:    (t) => authStore.getState().setTokens(t),
  clearTokens:  () => authStore.getState().clearTokens(),
  refresh:      (rt) => apiClient.post('/auth/refresh', { refreshToken: rt }).then(r => r.data),
})

// In your HTTP client interceptor:
apiClient.interceptors.request.use(async (config) => {
  const token = await tokenManager.getAccessToken()
  config.headers.Authorization = `Bearer ${token}`
  return config
})
```

## API

### `createEntityStore<T, TCreate, TUpdate>(config)`

Creates a Zustand-powered entity store.

| Method | Returns | Description |
|---|---|---|
| `fetch()` | `Promise<void>` | Replace local items with server data |
| `fetchById(id)` | `Promise<void>` | Fetch single entity, then re-fetch list |
| `create(data)` | `Promise<T>` | Create, then re-fetch (or optimistic insert) |
| `update(id, data)` | `Promise<T>` | Update, then re-fetch (or optimistic patch) |
| `delete(id)` | `Promise<void>` | Delete, then re-fetch (or optimistic remove) |
| `select(id)` | `void` | Set `selectedId` locally |
| `clearError()` | `void` | Clear error state |
| `reset()` | `void` | Reset to initial state |

| Property | Type | Description |
|---|---|---|
| `items` | `T[]` | Cached entity list (read-only) |
| `selected` | `T \| null` | Entity matching `selectedId` |
| `isLoading` | `boolean` | True during any API call |
| `error` | `string \| null` | Last error message |

### Config

| Option | Default | Description |
|---|---|---|
| `name` | required | Human-readable entity name |
| `sync` | `'client-first'` | `'client-first'` or `'server-first'` |
| `api` | required | `{ list, getById, create, update, remove }` |
| `onSubscribe` | `undefined` | `(handler) => unsubscribe` for WebSocket integration |
| `versioning` | `false` | Enable version stamp helpers |
| `versionSelector` | `(e) => e.version` | Extract version from entity |
| `onMutate` | `undefined` | Callback after every successful mutation |

### `createWebSocketClient(options)`

| Method | Returns | Description |
|---|---|---|
| `subscribe(type, handler)` | `() => void` | Register handler for entity type |
| `connect()` | `void` | Connect (auto-called) |
| `disconnect()` | `void` | Disconnect and stop reconnecting |

### `createTokenManager(options)`

| Method | Returns | Description |
|---|---|---|
| `getAccessToken()` | `Promise<string>` | Valid token, refreshing if needed |
| `refreshNow()` | `Promise<void>` | Force refresh |
| `invalidate()` | `void` | Clear tokens, notify listeners |
| `onStatusChange(cb)` | `() => void` | Subscribe to auth status |

## Migration guide

### From raw Zustand stores

If you have existing Zustand stores that manually call APIs and update local state, migrate one entity at a time:

**Before:**
```ts
const usePersonaStore = create((set) => ({
  items: [],
  fetch: async () => {
    const res = await api.get('/personas')
    set({ items: res.data })
  },
  delete: async (id) => {
    await api.delete(`/personas/${id}`)
    set((s) => ({ items: s.items.filter(p => p.id !== id) }))
  },
}))
```

**After:**
```ts
const personaStore = createEntityStore<Persona>({
  name: 'persona',
  api: {
    list:    () => api.get('/personas').then(r => r.data),
    remove:  (id) => api.delete(`/personas/${id}`),
    // ... etc
  },
})
```

For React, wrap with `useSyncExternalStore` or subscribe via `useStore(personaStore)`.

## License

MIT
