/**
 * Test utilities for sure-state stores.
 *
 * Provides:
 * - `createMockApi` — simulates server responses with controllable delays/errors
 * - `waitForStore` — waits for a store condition in tests
 * - `recordActions` — captures all store actions for assertions
 * - `withFakeTimers` — helper for testing loading states
 *
 * Usage:
 * ```ts
 * import { createEntityStore, createMockApi, recordActions } from 'sure-state'
 * import { describe, it, expect } from 'vitest'
 *
 * it('re-fetches after delete', async () => {
 *   const api = createMockApi()
 *   const store = createEntityStore({ name: 'test', api })
 *   const actions = recordActions(store)
 *
 *   await store.fetch()
 *   expect(store.items).toHaveLength(2)
 *
 *   await store.delete('1')
 *   expect(store.items).toHaveLength(1)
 *   expect(actions.list()).toMatchObject([
 *     { kind: 'fetch', success: true },
 *     { kind: 'delete', success: true },
 *   ])
 * })
 * ```
 */

import type { EntityApi, EntityStore } from './types'
import type { ActionRecord } from './inspector'
import { createEntityStore } from './create-entity-store'

export interface MockEntity {
  id: string
  name: string
  version?: number
  [key: string]: unknown
}

/**
 * Create a mock API backed by an in-memory array.
 * Supports configurable delay and failure injection.
 */
export function createMockApi<T extends MockEntity>(
  initialData: T[] = [],
  options: {
    /** Simulated network latency (ms). Default: 0. */
    delay?: number
    /** Make `list()` fail. */
    failList?: boolean
    /** Make `create()` fail. */
    failCreate?: boolean
    /** Make `update()` fail. */
    failUpdate?: boolean
    /** Make `remove()` fail. */
    failRemove?: boolean
    /** Error message to throw on failure. */
    errorMessage?: string
  } = {},
): EntityApi<T, Partial<T>, Partial<T>> {
  let data = [...initialData]
  let nextId = data.length + 1
  const { delay = 0, failList, failCreate, failUpdate, failRemove, errorMessage = 'Simulated error' } = options

  function wait(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  function maybeFail(shouldFail: boolean | undefined): void {
    if (shouldFail) throw new Error(errorMessage)
  }

  return {
    list: async () => {
      await wait(delay)
      maybeFail(failList)
      return [...data]
    },
    getById: async (id: string) => {
      await wait(delay)
      const item = data.find((d) => d.id === id)
      if (!item) throw new Error('Not found')
      return { ...item }
    },
    create: async (item: Partial<T>) => {
      await wait(delay)
      maybeFail(failCreate)
      const created = { ...item, id: String(nextId++), version: 1 } as unknown as T
      data.push(created)
      return { ...created }
    },
    update: async (id: string, updates: Partial<T>) => {
      await wait(delay)
      maybeFail(failUpdate)
      const idx = data.findIndex((d) => d.id === id)
      if (idx === -1) throw new Error('Not found')
      data[idx] = { ...data[idx], ...updates, version: ((data[idx]?.version ?? 0) + 1) } as T
      return { ...data[idx] }
    },
    remove: async (id: string) => {
      await wait(delay)
      maybeFail(failRemove)
      data = data.filter((d) => d.id !== id)
    },
  }
}

/**
 * Wait for a store condition to be true.
 * Useful for testing async store behaviour without arbitrary timeouts.
 *
 * @example
 * ```ts
 * await waitForStore(store, (s) => !s.isLoading)
 * expect(store.items).toHaveLength(3)
 * ```
 */
export async function waitForStore(
  store: EntityStore<any, any, any>,
  predicate: (store: EntityStore<any, any, any>) => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate(store)) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`waitForStore timed out after ${timeoutMs}ms`)
}

/**
 * Intercept and record all actions on a store for test assertions.
 * Returns a recorder object with `list()`, `last()`, `clear()`.
 *
 * @example
 * ```ts
 * const store = createEntityStore(...)
 * const rec = recordActions(store)
 *
 * await store.fetch()
 * expect(rec.last().kind).toBe('fetch')
 * expect(rec.last().success).toBe(true)
 * ```
 */
export function recordActions(store: EntityStore<any, any, any> & { __inspector_recorder?: ActionRecord[] }) {
  const recorded: ActionRecord[] = []
  store.__inspector_recorder = recorded

  const origFetch = store.fetch.bind(store)
  store.fetch = async () => {
    const start = performance.now()
    try {
      await origFetch()
      recorded.push({ kind: 'fetch', success: true, durationMs: Math.round(performance.now() - start), id: '', entityName: '', timestamp: 0 })
    } catch (e: any) {
      recorded.push({ kind: 'fetch', success: false, durationMs: Math.round(performance.now() - start), id: '', entityName: '', timestamp: 0, detail: e?.message })
      throw e
    }
  }

  const origCreate = store.create.bind(store)
  store.create = async (data: any) => {
    const start = performance.now()
    try {
      const r = await origCreate(data)
      recorded.push({ kind: 'create', success: true, durationMs: Math.round(performance.now() - start), id: '', entityName: '', timestamp: 0 })
      return r
    } catch (e: any) {
      recorded.push({ kind: 'create', success: false, durationMs: Math.round(performance.now() - start), id: '', entityName: '', timestamp: 0, detail: e?.message })
      throw e
    }
  }

  const origUpdate = store.update.bind(store)
  store.update = async (id: string, data: any) => {
    const start = performance.now()
    try {
      const r = await origUpdate(id, data)
      recorded.push({ kind: 'update', success: true, durationMs: Math.round(performance.now() - start), id: '', entityName: '', timestamp: 0 })
      return r
    } catch (e: any) {
      recorded.push({ kind: 'update', success: false, durationMs: Math.round(performance.now() - start), id: '', entityName: '', timestamp: 0, detail: e?.message })
      throw e
    }
  }

  const origDelete = store.delete.bind(store)
  store.delete = async (id: string) => {
    const start = performance.now()
    try {
      await origDelete(id)
      recorded.push({ kind: 'delete', success: true, durationMs: Math.round(performance.now() - start), id: '', entityName: '', timestamp: 0 })
    } catch (e: any) {
      recorded.push({ kind: 'delete', success: false, durationMs: Math.round(performance.now() - start), id: '', entityName: '', timestamp: 0, detail: e?.message })
      throw e
    }
  }

  return {
    /** Full list of recorded actions. */
    list: () => recorded,
    /** Most recent action, or null. */
    last: (): ActionRecord | null => recorded[recorded.length - 1] ?? null,
    /** Clear the record. */
    clear: () => { recorded.length = 0 },
  }
}

/**
 * Create a store that auto-configures a mock API for quick prototyping / testing.
 *
 * @example
 * ```ts
 * const { store, api, actions } = createTestStore([
 *   { id: '1', name: 'Alice' },
 *   { id: '2', name: 'Bob' },
 * ])
 *
 * await store.fetch()
 * expect(store.items).toHaveLength(2)
 * ```
 */
/** @internal */
function _createTestStore<T extends MockEntity>(
  initialData: T[] = [],
  options: { delay?: number } = {},
) {
  const api = createMockApi(initialData, options)
  const store = createEntityStore<T>({ name: 'test', api })
  const actions = recordActions(store)
  return { store: store as unknown as EntityStore<T, Partial<T>, Partial<T>>, api, actions }
}

export { _createTestStore as createTestStore }
