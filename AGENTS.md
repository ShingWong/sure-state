# sure-state — Agent Development Guide

## Project Overview

Client-server state synchronization for TypeScript apps. Built on Zustand/vanilla. Server is always the source of truth.

**GitHub:** `https://github.com/ShingWong/sure-state` (public)
**npm:** `sure-state`
**context7 library ID:** `/shingwong/sure-state`

## Build & Test

```bash
npm run build     # tsc
npm test          # vitest run (27 tests)
npm run lint      # tsc --noEmit
```

## Exports

| Export | Source | Description |
|--------|--------|-------------|
| `createEntityStore` | `create-entity-store.ts` | Zustand-powered entity store with CRUD, sync strategies, version stamps |
| `createWebSocketClient` | `websocket.ts` | WebSocket client for real-time push |
| `createTokenManager` | `auth.ts` | Proactive JWT refresh (decode JWT, refresh before expiry) |
| `createInspector` | `inspector.ts` | Action history recording, debug reports |
| `createEventBus` | `events.ts` | Typed event bus for store mutations |
| `createMetricsCollector`, `attachMetrics`, `attachOtelSpans` | `instrumentation.ts` | Prometheus metrics + OpenTelemetry spans |
| `attachLogger` | `logger.ts` | Console-action logger |
| `createMockApi`, `waitForStore`, `recordActions`, `createTestStore` | `test-utils.ts` | Test helpers |
| `createCookieStore`, `syncToCookie` | `cookie-store.ts` | Cookie-backed key-value store for client-side persistence |
| `createAgentTools` | `agent-tools.ts` | Build agent-inspectable tool sets (list_stores, get_store_state, get_action_history, dump_report, get_metrics) |
| `createMcpServer` | `create-mcp-server.ts` | Lightweight MCP-over-stdio server (no SDK needed). Connect agents like OpenCode, Claude Desktop |
| `InspectorPanel` | `react-devtools.tsx` | React debug panel component |
| `getVersion`, `stampFor`, `versionWhere`, `ConflictError` | `version-stamp.ts` | Optimistic concurrency control |

## Agent Tools

Use `createAgentTools` to generate tools any AI agent can call:

```ts
import { createAgentTools, createMcpServer } from 'sure-state'
import { createEntityStore, createInspector } from 'sure-state'

const store = createEntityStore<Item>({ name: 'items', ... })
const inspector = createInspector(store)

const tools = createAgentTools({
  stores: { items: store },
  inspectors: { items: inspector },
})

// Start MCP server for OpenCode/Claude Desktop
createMcpServer(tools)
```

### Available tools
- `list_stores` — All stores with items count, loading, error status
- `get_store_state` — Full snapshot of any store (all items + metadata)
- `get_action_history` — Recent actions (fetch, create, update, delete with timing)
- `dump_report` — Comprehensive debug report (one store or all)
- `get_metrics` — Prometheus metrics snapshot

## MCP Server

`createMcpServer` implements a lightweight MCP-over-stdio server. No external SDK needed. Accepts custom input/output streams for testing.

### Protocol
- JSON-RPC 2.0 over stdin/stdout, newline-delimited
- Methods: `initialize`, `tools/list`, `tools/call`, `notifications/initialized`
- Connect via: `node your-script.js`

## Code Style
- TypeScript strict mode with `noUncheckedIndexedAccess`
- ESM modules
- No runtime dependencies (Zustand and React are peer deps)
- Minimal external dependencies (only dev deps: vitest, typescript, @types/node)
