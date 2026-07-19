/**
 * Lightweight event emitter for store lifecycle events.
 * Powers the instrumentation adaptors (OTEL, Prometheus) and custom hooks.
 *
 * Every entity store emits the following events:
 *
 * | Event | Payload | When |
 * |---|---|---|
 * | `action` | `ActionRecord` | Any mutation completes (success or failure) |
 * | `error` | `{ message, kind }` | A store operation fails |
 * | `slow` | `ActionRecord` | An operation exceeds the threshold |
 * | `sync` | `{ status }` | WebSocket connection changes |
 * | `push` | `PushEvent` | Server pushes an entity update |
 */

import type { ActionRecord } from './inspector'

export type StoreEventType = 'action' | 'error' | 'slow' | 'sync' | 'push'

export interface StoreEventPayload {
  action: ActionRecord
  error: { message: string; kind: string }
  slow: ActionRecord
  sync: { status: string }
  push: { entityType: string; kind: string }
}

export type StoreEventHandler<E extends StoreEventType> = (payload: StoreEventPayload[E]) => void

export interface StoreEventBus {
  on: <E extends StoreEventType>(event: E, handler: StoreEventHandler<E>) => () => void
  emit: <E extends StoreEventType>(event: E, payload: StoreEventPayload[E]) => void
  clear: () => void
}

export function createEventBus(): StoreEventBus {
  const listeners = new Map<string, Set<Function>>()

  function on<E extends StoreEventType>(event: E, handler: StoreEventHandler<E>): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(handler)
    return () => { listeners.get(event)?.delete(handler) }
  }

  function emit<E extends StoreEventType>(event: E, payload: StoreEventPayload[E]): void {
    const handlers = listeners.get(event)
    if (!handlers) return
    for (const handler of handlers) {
      try { handler(payload) }
      catch { /* silent — one bad listener shouldn't break others */ }
    }
  }

  function clear() { listeners.clear() }

  return { on, emit, clear }
}
