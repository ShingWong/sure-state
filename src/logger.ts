/**
 * Logger middleware for entity stores.
 *
 * Attaches a console-group logger that prints every mutation
 * with before/after state snapshots.
 *
 * Usage:
 * ```ts
 * import { createEntityStore, attachLogger } from 'sure-state'
 *
 * const store = createEntityStore<Persona>({ name: 'persona', ... })
 * const detach = attachLogger(store, { collapsed: true })
 *
 * // Later, to remove:
 * detach()
 * ```
 */

import type { EntityStore, MutationEvent } from './types'

export interface LoggerOptions {
  /** Start with collapsed groups (default: true). */
  collapsed?: boolean

  /** Color for the group title (default: '#a6e3a1'). */
  color?: string

  /** Only log these action kinds. */
  filter?: Array<'fetch' | 'create' | 'update' | 'delete' | 'push'>
}

const defaultColor = '#a6e3a1'

const kindColors: Record<string, string> = {
  fetch: '#89b4fa',
  create: '#a6e3a1',
  update: '#f9e2af',
  delete: '#f38ba8',
  push: '#cba6f7',
}

/**
 * Attach a console logger to an entity store.
 * Returns an unsubscribe function.
 */
export function attachLogger(
  store: EntityStore<any, any, any>,
  options: LoggerOptions = {},
): () => void {
  const {
    collapsed = true,
    color = defaultColor,
    filter,
  } = options

  const groupFn = collapsed ? console.groupCollapsed : console.group

  function log(kind: string, detail?: string) {
    if (filter && !filter.includes(kind as any)) return

    const label = `%c[${store.items?.length ?? '?'}] ${kind}`
    const style = `color: ${kindColors[kind] ?? color}; font-weight: bold;`

    groupFn(label, style, detail ?? '')
    console.log('items:', store.items)
    console.log('isLoading:', store.isLoading)
    console.log('error:', store.error)
    console.groupEnd()
  }

  // Monkey-patch store methods
  const origFetch = store.fetch.bind(store)
  store.fetch = async () => {
    try {
      await origFetch()
      log('fetch')
    } catch (e) {
      log('error', 'fetch')
      throw e
    }
  }

  const origCreate = store.create.bind(store)
  store.create = async (data: any) => {
    try {
      const result = await origCreate(data)
      log('create', JSON.stringify(data).slice(0, 100))
      return result
    } catch (e) {
      log('error', 'create')
      throw e
    }
  }

  const origUpdate = store.update.bind(store)
  store.update = async (id: string, data: any) => {
    try {
      const result = await origUpdate(id, data)
      log('update', `id=${id}`)
      return result
    } catch (e) {
      log('error', 'update')
      throw e
    }
  }

  const origDelete = store.delete.bind(store)
  store.delete = async (id: string) => {
    try {
      await origDelete(id)
      log('delete', `id=${id}`)
    } catch (e) {
      log('error', 'delete')
      throw e
    }
  }

  return () => {
    // Restore originals
    store.fetch = origFetch
    store.create = origCreate
    store.update = origUpdate
    store.delete = origDelete
  }
}
