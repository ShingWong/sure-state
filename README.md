# sure-state

**Client-server state synchronization for TypeScript apps — the server is always the source of truth.** Fetch from the server, mutate through the store, subscribe to real-time push via WebSocket, and inspect every action with built-in logging, metrics, and agent-inspectable tooling.

```ts
import { createEntityStore } from 'sure-state'

interface Persona { id: string; name: string; description: string | null }

const personaStore = createEntityStore<Persona>({
  name: 'persona',
  api: {
    list:    () => api.get('/personas').then(r => r.data),
    create:  (data) => api.post('/personas', data).then(r => r.data),
    update:  (id, data) => api.put(`/personas/${id}`, data).then(r => r.data),
    remove:  (id) => api.delete(`/personas/${id}`),
  },
})

await personaStore.fetch()
console.log(personaStore.items)    // typed, always consistent with server
console.log(personaStore.isLoading)
```

### Why sure-state?

| Problem | How sure-state solves it |
|---------|--------------------------|
| **Client-server state drift** | Every write re-fetches from the server (or applies a push event). The server is always the authority — no stale caches, no silent conflicts. |
| **No visibility into state** | Built-in inspector records every action with timing and state snapshots. `attachLogger` adds colored console groups with before/after state. |
| **Blind mutations** | `createMetricsCollector` + `attachOtelSpans` expose operation counters, latency histograms, and OpenTelemetry spans for every store action. |
| **Agents can't inspect state** | `createAgentTools` exposes `list_stores`, `get_store_state`, `get_action_history`, `dump_report`, `get_metrics` as MCP tools. Agents (OpenCode, Claude Desktop) connect via `createMcpServer`. |
| **Multi-writer races** | Version stamps (`stampFor`, `versionWhere`, `ConflictError`) for optimistic concurrency control. |
| **Manual sync logic** | Two declarative sync strategies: `client-first` (optimistic, single-user) and `server-first` (pessimistic, collaborative). Set once per store. |

### How it compares

| | sure-state | Zustand + manual API | TanStack Query | Redux Toolkit |
|---|---|---|---|---|
| Server is source of truth | ✅ Built-in | ❌ You write it | ✅ Yes | ❌ No |
| Sync strategies | ✅ `client-first` / `server-first` | ❌ | ❌ Stale-while-revalidate only | ❌ |
| WebSocket real-time | ✅ Built-in `createWebSocketClient` | ❌ | ⚠️ Via `QueryClient.setQueryData` | ❌ |
| Action inspector | ✅ `createInspector` with full history | ❌ | ❌ DevTools only | ✅ Redux DevTools |
| Logging | ✅ `attachLogger` (colored console groups) | ❌ | ❌ | ❌ |
| Prometheus metrics | ✅ `createMetricsCollector` | ❌ | ❌ | ❌ |
| OpenTelemetry | ✅ `attachOtelSpans` | ❌ | ❌ | ❌ |
| Agent MCP tools | ✅ `createAgentTools` + `createMcpServer` | ❌ | ❌ | ❌ |
| Test utilities | ✅ `createMockApi`, `recordActions`, `waitForStore` | ❌ | ✅ `QueryClient` mocking | ❌ |
| Framework-agnostic | ✅ Zustand vanilla (React/Vue/Svelte/vanilla JS) | ✅ Same | ❌ React-only | ✅ Same |
| Optimistic concurrency | ✅ Version stamps | ❌ | ❌ | ❌ |
| Bundle size | ~800 lines core | ~100 lines + zustand | ~25 KB | ~12 KB + RTK |

## Installation

```bash
npm install sure-state
```

Peer dependencies:

```bash
npm install zustand                           # required (state engine)
npm install react                             # optional (for InspectorPanel)
```

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

await personaStore.fetch()
console.log(personaStore.items)       // typed array
console.log(personaStore.isLoading)   // boolean
console.log(personaStore.error)       // string | null

await personaStore.create({ name: 'Support Bot', description: 'You are helpful...' })
// After create: items list is refreshed from server

personaStore.select('abc-123')
console.log(personaStore.selected)    // single entity or null
```

## Sync strategies

### `client-first` (default)

Optimistic local update + re-fetch. Use when the current user is the **only writer**.

```
create → api.create(data) → prepend to local items → done
delete → api.remove(id)   → filter from local items → done
```

Fast UX. Safe for single-user apps (user owns their data).

### `server-first`

Always re-fetch after every mutation. Never trust local state after a write.

```
create → api.create(data) → re-fetch full list → done
delete → api.remove(id)   → re-fetch full list → done
```

Slower per-mutation but guarantees consistency. Required for collaborative multi-user or agent-managed data.

## Logging

Attach a console logger to visualize every mutation with colored groups and before/after state:

```ts
import { attachLogger } from 'sure-state'

const detach = attachLogger(personaStore, { collapsed: true })
// Every fetch/create/update/delete now logs:
//   [persona] fetch  (green)
//   items: [...]     isLoading: false   error: null

// Later, to remove:
detach()
```

Logger options:

| Option | Default | Description |
|--------|---------|-------------|
| `collapsed` | `true` | Start with collapsed console groups |
| `color` | `#a6e3a1` | Color for group title |
| `filter` | — | Only log these kinds: `fetch`, `create`, `update`, `delete`, `push` |

## Instrumentation

### Prometheus metrics

```ts
import { createEntityStore, createEventBus, createMetricsCollector, attachMetrics } from 'sure-state'

const bus = createEventBus()
const store = createEntityStore({ name: 'persona', api, onSubscribe: (h) => bus.on('push', h) })
const metrics = createMetricsCollector()
attachMetrics(bus, metrics, 'persona')

// Expose on your /metrics endpoint:
app.get('/metrics', (req, res) => {
  res.type('text/plain').send(metrics.dump())
})
```

Outputs counters (`persona_fetch_total`, `persona_create_total`), latency histograms (`persona_action_duration_ms`), and gauges (`persona_items_count`).

### OpenTelemetry

```ts
import { attachOtelSpans } from 'sure-state'

attachOtelSpans(bus, 'persona')
// Every store action generates an OTEL span with attributes:
//   kind, entityName, success, durationMs
```

## Inspection

### Action history

```ts
import { createInspector } from 'sure-state'

const inspector = createInspector(personaStore)

console.table(inspector.dump().recentActions)
// ┌─────────┬────────┬────────────┬───────────┬─────────┐
// │   id    │  kind  │  success   │ durationMs│ detail  │
// ├─────────┼────────┼────────────┼───────────┼─────────┤
// │ act_1   │ fetch  │ true       │ 142       │         │
// │ act_2   │ create │ true       │ 89        │ {...}   │
// └─────────┴────────┴────────────┴───────────┴─────────┘

const report = inspector.dump()
// { entity: 'persona', sync: 'client-first', itemsCount: 12,
//   isLoading: false, error: null, lastAction: {...}, ... }
```

| Method | Returns | Description |
|--------|---------|-------------|
| `getActions()` | `ActionRecord[]` | Full action log |
| `dump()` | `InspectorReport` | Debug report with summary + recent actions |
| `setLogging(bool)` | `void` | Enable/disable at runtime |
| `clear()` | `void` | Erase history |
| `onAction(cb)` | `() => void` | Subscribe to new actions |

### React devtools panel

```ts
import { InspectorPanel } from 'sure-state/react-devtools'

function DebugDrawer() {
  return (
    <InspectorPanel
      stores={{ personas: personaStore, sessions: sessionStore }}
      inspectors={{ personas: personaInspector, sessions: sessionInspector }}
    />
  )
}
```

## Real-time sync (WebSocket)

```ts
import { createEntityStore, createWebSocketClient } from 'sure-state'

const ws = createWebSocketClient({
  url: 'wss://api.example.com/ws',
  getToken: () => localStorage.getItem('access_token'),
  reconnectDelay: 3000,
  maxReconnectAttempts: 10,
  onStatusChange: (status) => console.log('WS:', status),
})

const personaStore = createEntityStore<Persona>({
  name: 'persona',
  api: { /* ... */ },
  onSubscribe: (handler) => ws.subscribe('persona', handler),
})
// Server pushes { type: 'updated', entity: {...} } → store auto-patches
```

WebSocket features: auto-connect, token-based auth, automatic reconnection with backoff, entity-scoped subscriptions.

## Version stamps (optimistic concurrency)

When multiple writers (users + agents) can race on the same entity:

```ts
import { stampFor, ConflictError } from 'sure-state'

// Client side:
const stamp = stampFor(existingPersona)
await api.update(id, { ...changes, ...stamp })

// Server side:
const result = await sql`
  UPDATE "Persona" SET name = ${name}, version = version + 1
  WHERE id = ${id} AND version = ${stamp.version}
  RETURNING *
`
if (result.length === 0) throw new ConflictError('Persona')
```

| Export | Purpose |
|--------|---------|
| `stampFor(entity)` | Returns `{ version }` from entity |
| `versionWhere(entity)` | Returns `{ version }` for SQL WHERE clause |
| `getVersion(entity)` | Extract raw version value |
| `ConflictError` | Error class for version conflicts |

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

Decodes JWTs to proactively refresh before expiry. Emits `onStatusChange` for auth state.

## Event bus

```ts
import { createEventBus } from 'sure-state'

const bus = createEventBus()

bus.on('action', (record) => sendToAnalytics(record))
bus.on('error', ({ message, kind }) => notifySentry(message))
bus.on('slow', (record) => console.warn('Slow action:', record))
bus.on('sync', ({ status }) => updateConnectionIndicator(status))
```

| Event | Payload | When |
|-------|---------|------|
| `action` | `ActionRecord` | Any mutation completes |
| `error` | `{ message, kind }` | A store operation fails |
| `slow` | `ActionRecord` | Operation exceeds threshold |
| `sync` | `{ status }` | WebSocket connection changes |
| `push` | `PushEvent` | Server pushes an update |

## Agent tools (MCP)

AI coding assistants (OpenCode, Claude Desktop, Cursor) can inspect and reason about your application state in real time:

```ts
import { createEntityStore, createInspector, createAgentTools, createMcpServer } from 'sure-state'

const personaStore = createEntityStore<Persona>({ name: 'persona', api: { /* ... */ } })
const inspector = createInspector(personaStore)

const tools = createAgentTools({
  stores: { personas: personaStore },
  inspectors: { personas: inspector },
})

// Start MCP server for OpenCode/Claude Desktop
createMcpServer(tools)
```

Configure in `opencode.json`:

```json
{
  "mcpServers": {
    "sure-state": {
      "command": "node",
      "args": ["path/to/your-mcp-server.js"]
    }
  }
}
```

### Available agent tools

| Tool | Purpose |
|------|---------|
| `list_stores` | All stores with items count, loading, error, selection |
| `get_store_state` | Full snapshot of any store (all items + metadata) |
| `get_action_history` | Recent actions with timing (fetch, create, update, delete) |
| `dump_report` | Comprehensive debug report (one store or all) |
| `get_metrics` | Prometheus metrics snapshot |

### OpenCode workflow example

Prompt OpenCode to debug application state:

```
Using sure-state, debug the state of my persona store.
1. List all stores with their current status
2. Get the full state of the "personas" store
3. Show the last 10 actions with timing
4. Dump a debug report for the "personas" store
5. Check the metrics for slow operations
```

OpenCode connects via MCP and calls `list_stores`, `get_store_state`, `get_action_history`, `dump_report`, `get_metrics` — inspecting state between every step.

### What agents should know

| File | What it tells the agent |
|------|------------------------|
| `src/create-entity-store.ts` | `createEntityStore` — config, sync strategies, CRUD methods |
| `src/types.ts` | Core interfaces: `EntityStore`, `EntityStoreConfig`, `SyncStrategy`, `EntityApi` |
| `src/inspector.ts` | `createInspector` — action history, debug reports |
| `src/logger.ts` | `attachLogger` — colored console logging |
| `src/instrumentation.ts` | `createMetricsCollector`, `attachMetrics`, `attachOtelSpans` |
| `src/events.ts` | `createEventBus` — typed event system |
| `src/agent-tools.ts` | `createAgentTools` — all agent-inspectable MCP tools |
| `src/create-mcp-server.ts` | `createMcpServer` — lightweight MCP protocol over stdio |
| `src/websocket.ts` | `createWebSocketClient` — real-time sync |
| `src/auth.ts` | `createTokenManager` — JWT lifecycle |
| `src/version-stamp.ts` | `stampFor`, `ConflictError` — optimistic concurrency |
| `src/test-utils.ts` | `createMockApi`, `recordActions`, `waitForStore`, `createTestStore` |

## API

### `createEntityStore<T, TCreate, TUpdate>(config)`

| Method | Returns | Description |
|--------|---------|-------------|
| `fetch()` | `Promise<void>` | Replace local items with server data |
| `fetchById(id)` | `Promise<void>` | Fetch single entity, then re-fetch list |
| `create(data)` | `Promise<T>` | Create, then re-fetch (or optimistic insert) |
| `update(id, data)` | `Promise<T>` | Update, then re-fetch (or optimistic patch) |
| `delete(id)` | `Promise<void>` | Delete, then re-fetch (or optimistic remove) |
| `select(id)` | `void` | Set `selectedId` locally |
| `clearError()` | `void` | Clear error state |
| `reset()` | `void` | Reset to initial state |
| `subscribe(selector)` | function | Zustand subscription |
| `getState()` | snapshot | Current state |
| `applyPushEvent(event)` | `void` | Apply a push event (internal, called by WebSocket) |

| Property | Type | Description |
|----------|------|-------------|
| `items` | `T[]` | Cached entity list (read-only) |
| `selected` | `T \| null` | Entity matching `selectedId` |
| `selectedId` | `string \| null` | Currently selected entity ID |
| `isLoading` | `boolean` | True during any API call |
| `error` | `string \| null` | Last error message |

### Config

| Option | Default | Description |
|--------|---------|-------------|
| `name` | required | Human-readable entity name |
| `sync` | `'client-first'` | `'client-first'` or `'server-first'` |
| `api` | required | `{ list, getById, create, update, remove }` |
| `onSubscribe` | `undefined` | `(handler) => unsubscribe` for WebSocket |
| `versioning` | `false` | Enable version stamp helpers |
| `versionSelector` | `(e) => e.version` | Extract version from entity |
| `onMutate` | `undefined` | Callback after every successful mutation |

## Test utilities

```ts
import { createMockApi, recordActions, waitForStore, createTestStore } from 'sure-state'

// Mock API backed by in-memory array
const api = createMockApi([{ id: '1', name: 'Alice' }])
const store = createEntityStore({ name: 'test', api })

// Record actions for assertions
const actions = recordActions(store)
await store.delete('1')
expect(actions.last().kind).toBe('delete')

// Wait for async state
await waitForStore(store, (s) => !s.isLoading)

// Quick test setup
const { store, api, actions } = createTestStore([{ id: '1', name: 'Alice' }])
```

## Development

```bash
git clone git@github.com:ShingWong/sure-state.git
cd sure-state
npm install
npm run build
npm test                      # 27 tests
npm run lint                  # tsc --noEmit
```
