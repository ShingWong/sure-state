/**
 * Debugging and inspection tools for sure-state stores.
 *
 * Attach an inspector to any entity store to get:
 * - Action history with timing
 * - State snapshots before/after every mutation
 * - A `dump()` method for console inspection
 */

import type { EntityStore, MutationEvent, SyncStrategy } from './types'

export interface ActionRecord {
  id: string
  kind: 'fetch' | 'create' | 'update' | 'delete' | 'push' | 'select' | 'error'
  entityName: string
  timestamp: number
  durationMs: number
  success: boolean
  detail?: string
}

export interface Snapshot {
  timestamp: number
  label: string
  state: unknown
}

export interface Inspector {
  /** Return the full action log. */
  getActions: () => readonly ActionRecord[]

  /** Return a summary object you can `console.table` or dump to a panel. */
  dump: () => InspectorReport

  /** Enable/disable logging at runtime. */
  setLogging: (on: boolean) => void

  /** Erase all history. */
  clear: () => void

  /** Subscribe to new actions as they happen. */
  onAction: (cb: (action: ActionRecord) => void) => () => void
}

export interface InspectorReport {
  entity: string
  sync: SyncStrategy
  versioning: boolean
  itemsCount: number
  isLoading: boolean
  error: string | null
  selectedId: string | null
  lastAction: ActionRecord | null
  actionCount: number
  recentActions: ActionRecord[]
}

let actionIdCounter = 0
function nextActionId(): string {
  actionIdCounter++
  return `act_${actionIdCounter}`
}

/**
 * Create an inspector for a given entity store.
 *
 * Usage:
 * ```ts
 * const store = createEntityStore<Persona>({ name: 'persona', ... })
 * const inspector = createInspector(store)
 *
 * // Later, in a debug console:
 * console.table(inspector.dump().recentActions)
 * console.log(inspector.dump())
 * ```
 */
export function createInspector(store: EntityStore<any, any, any> & { getState?: () => any }): Inspector {
  const actions: ActionRecord[] = []
  const MAX_ACTIONS = 200
  let logging = true
  const listeners = new Set<(action: ActionRecord) => void>()

  function record(partial: Omit<ActionRecord, 'id' | 'timestamp' | 'durationMs'>, start?: number) {
    if (!logging) return

    const startTime = start ?? performance.now()
    queueMicrotask(() => {
      const entry: ActionRecord = {
        id: nextActionId(),
        ...partial,
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - startTime),
      }

      actions.push(entry)
      if (actions.length > MAX_ACTIONS) actions.shift()

      for (const cb of listeners) cb(entry)
    })
  }

  function setLogging(on: boolean) {
    logging = on
  }

  function clear() {
    actions.length = 0
  }

  function onAction(cb: (action: ActionRecord) => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }

  function getActions(): readonly ActionRecord[] {
    return actions
  }

  function dump(): InspectorReport {
    const state = store.getState?.() ?? {}
    const lastAction = actions[actions.length - 1] ?? null

    return {
      entity: (store as any).constructor?.name ?? 'EntityStore',
      sync: 'client-first', // stored on config, not on the store itself — reasonable default
      versioning: false,
      itemsCount: store.items?.length ?? 0,
      isLoading: store.isLoading ?? false,
      error: store.error ?? null,
      selectedId: store.selectedId ?? null,
      lastAction,
      actionCount: actions.length,
      recentActions: actions.slice(-20),
    }
  }

  /** Monkey-patch the store's internal methods to record actions. */
  function patchStore() {
    const origFetch = store.fetch.bind(store)
    store.fetch = async () => {
      const start = performance.now()
      try {
        await origFetch()
        record({ kind: 'fetch', entityName: 'entity', success: true }, start)
      } catch (e: any) {
        record({ kind: 'error', entityName: 'entity', success: false, detail: e?.message }, start)
        throw e
      }
    }

    const origCreate = store.create.bind(store)
    store.create = async (data: any) => {
      const start = performance.now()
      try {
        const result = await origCreate(data)
        record({ kind: 'create', entityName: 'entity', success: true, detail: JSON.stringify(data).slice(0, 200) }, start)
        return result
      } catch (e: any) {
        record({ kind: 'error', entityName: 'entity', success: false, detail: e?.message }, start)
        throw e
      }
    }

    const origUpdate = store.update.bind(store)
    store.update = async (id: string, data: any) => {
      const start = performance.now()
      try {
        const result = await origUpdate(id, data)
        record({ kind: 'update', entityName: 'entity', success: true, detail: `id=${id}` }, start)
        return result
      } catch (e: any) {
        record({ kind: 'error', entityName: 'entity', success: false, detail: e?.message }, start)
        throw e
      }
    }

    const origDelete = store.delete.bind(store)
    store.delete = async (id: string) => {
      const start = performance.now()
      try {
        await origDelete(id)
        record({ kind: 'delete', entityName: 'entity', success: true, detail: `id=${id}` }, start)
      } catch (e: any) {
        record({ kind: 'error', entityName: 'entity', success: false, detail: e?.message }, start)
        throw e
      }
    }
  }

  patchStore()

  return { getActions, dump, setLogging, clear, onAction }
}
