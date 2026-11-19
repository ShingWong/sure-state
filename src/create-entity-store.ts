import { createStateStore } from './store.js'
import type {
  EntityStore,
  EntityStoreConfig,
  EntityStoreState,
  EntityStoreStore,
  MutationEvent,
  PushEvent,
} from './types.js'

export function createEntityStore<T extends { id: string }, TCreate = Partial<T>, TUpdate = Partial<T>>(
  config: EntityStoreConfig<T, TCreate, TUpdate>,
): EntityStore<T, TCreate, TUpdate> & EntityStoreStore<EntityStoreState<T>> {
  const {
    name,
    sync = 'client-first',
    api,
    onSubscribe,
    versioning = false,
    onMutate,
  } = config

  // The config type already allows number | string | undefined; the default
  // needs an explicit cast because T is generic and has no known `version`.
  const versionSelector: (entity: T) => number | string | undefined =
    config.versionSelector ?? ((entity: T) => (entity as any)?.version)

  const store = createStateStore<EntityStoreState<T>>(() => ({
    items: [],
    isLoading: false,
    error: null,
    selectedId: null,
  }))

  let fetchGen = 0
  /** Highest mutation generation started per entity. Stale replies are dropped. */
  const mutationGens = new Map<string, number>()

  function setLoading() {
    store.setState({ isLoading: true, error: null })
  }

  function setError(error: string | null) {
    store.setState({ isLoading: false, error })
  }

  function pushItems(items: T[]) {
    store.setState({ items, isLoading: false })
  }

  /** Start a mutation and return its generation token. */
  function beginMutation(id: string): number {
    const gen = (mutationGens.get(id) ?? 0) + 1
    mutationGens.set(id, gen)
    return gen
  }

  /** True when `id` has since received a newer local mutation or push. */
  function isSuperseded(id: string, gen: number): boolean {
    return mutationGens.get(id) !== gen
  }

  function versionOf(entity: T | undefined): number | string | undefined {
    if (!versioning || entity == null) return undefined
    try {
      return versionSelector(entity)
    } catch {
      return undefined
    }
  }

  /**
   * Reject an incoming entity whose version is older than the cached one.
   * Only comparable values of the same type are fenced — mixed/unknown
   * version types are left alone rather than guessed at.
   */
  function isStaleVersion(incoming: T, current: T): boolean {
    const inVer = versionOf(incoming)
    const curVer = versionOf(current)
    if (inVer == null || curVer == null) return false
    if (typeof inVer === 'number' && typeof curVer === 'number') return inVer < curVer
    if (typeof inVer === 'string' && typeof curVer === 'string') return inVer < curVer
    return false
  }

  function emit(event: MutationEvent<T>): void {
    try {
      onMutate?.(event)
    } catch {
      /* listener errors must not break store mutations */
    }
  }

  /** Replace the local items list with fresh data from the server. */
  async function fetch(): Promise<void> {
    const gen = ++fetchGen
    setLoading()
    try {
      const items = await api.list()
      if (gen !== fetchGen) return
      pushItems(items)
    } catch (err: any) {
      if (gen !== fetchGen) return
      setError(err?.message ?? `Failed to fetch ${name}`)
      throw err
    }
  }

  async function fetchById(id: string): Promise<void> {
    setLoading()
    try {
      await api.getById(id)
      // After fetching a single entity, re-fetch the full list
      // to guarantee consistency. The fetched entity is available
      // via `.items` after the re-fetch.
      await fetch()
    } catch (err: any) {
      setError(err?.message ?? `Failed to fetch ${name}`)
      throw err
    }
  }

  async function create(data: TCreate): Promise<T> {
    setLoading()
    try {
      const created = await api.create(data)

      if (sync === 'client-first') {
        store.setState((s) => ({
          items: [created, ...s.items],
          isLoading: false,
        }))
      } else {
        // server-first: re-fetch so we don't trust our local state
        await fetch()
      }

      emit({ kind: 'created', entity: created })
      return created
    } catch (err: any) {
      setError(err?.message ?? `Failed to create ${name}`)
      throw err
    }
  }

  async function update(id: string, data: TUpdate): Promise<T> {
    const gen = beginMutation(id)
    setLoading()
    try {
      const updated = await api.update(id, data)

      // A newer local mutation or push has already claimed this entity.
      if (isSuperseded(id, gen)) return updated

      if (sync === 'client-first') {
        store.setState((s) => ({
          items: s.items.map((item) => {
            if (item.id !== id) return item
            if (isStaleVersion(updated, item)) return item
            return updated
          }),
          isLoading: false,
        }))
      } else {
        await fetch()
      }

      emit({ kind: 'updated', entity: updated })
      return updated
    } catch (err: any) {
      if (!isSuperseded(id, gen)) {
        setError(err?.message ?? `Failed to update ${name}`)
      }
      throw err
    }
  }

  /**
   * Atomic single-field mutation. Only the mutated slot crosses the wire,
   * and out-of-order responses are discarded via per-entity generations.
   */
  async function updateField<K extends keyof T>(id: string, field: K, value: T[K]): Promise<T> {
    const currentEntity = store.getState().items.find((item) => item.id === id)
    const expectedVersion = versionOf(currentEntity) // undefined when not versioning

    const gen = beginMutation(id)
    setLoading()
    try {
      let updated: T
      if (config.updateField) {
        updated = await config.updateField(id, field, value, expectedVersion)
      } else if (api.updateField) {
        updated = await api.updateField(id, field, value, expectedVersion)
      } else {
        // Scalar fallback — one slot, never a caller-supplied object spread.
        updated = await api.update(id, { [field]: value } as unknown as TUpdate)
      }

      if (isSuperseded(id, gen)) return updated

      if (sync === 'client-first') {
        store.setState((s) => ({
          items: s.items.map((item) => {
            if (item.id !== id) return item
            if (isStaleVersion(updated, item)) return item
            return updated
          }),
          isLoading: false,
        }))
      } else {
        await fetch()
      }

      emit({ kind: 'updated', entity: updated, field, value })
      return updated
    } catch (err: any) {
      if (!isSuperseded(id, gen)) {
        setError(err?.message ?? `Failed to update ${String(field)} on ${name}`)
      }
      throw err
    }
  }

  async function del(id: string): Promise<void> {
    setLoading()
    try {
      await api.remove(id)

      if (sync === 'client-first') {
        store.setState((s) => ({
          items: s.items.filter((item) => item.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
          isLoading: false,
        }))
      } else {
        await fetch()
      }

      emit({ kind: 'deleted', id })
    } catch (err: any) {
      setError(err?.message ?? `Failed to delete ${name}`)
      throw err
    }
  }

  function select(id: string | null) {
    store.setState({ selectedId: id })
  }

  function clearError() {
    store.setState({ error: null })
  }

  function applyPushEvent(event: PushEvent<T>) {
    const { type, entity, field } = event

    // A push is a newer authoritative transition: invalidate any local
    // mutation still in flight for this entity. A deleted entity needs no
    // generation entry afterwards (absence already reads as "superseded").
    if (type === 'deleted') {
      mutationGens.delete(entity.id)
    } else {
      beginMutation(entity.id)
    }

    store.setState((s) => {
      switch (type) {
        case 'created':
          return { items: [entity, ...s.items] }
        case 'updated':
          return {
            items: s.items.map((item) => {
              if (item.id !== entity.id) return item
              if (isStaleVersion(entity, item)) return item
              return entity
            }),
          }
        case 'deleted':
          return {
            items: s.items.filter((item) => item.id !== entity.id),
            selectedId:
              s.selectedId === entity.id ? null : s.selectedId,
          }
        default:
          return s
      }
    })

    emit({
      kind: type,
      entity,
      ...(field != null ? { field, value: (entity as any)[field] } : {}),
    })
  }

  function reset() {
    mutationGens.clear()
    // Invalidate any in-flight fetch so it cannot repopulate a reset store.
    fetchGen++
    store.setState({ items: [], isLoading: false, error: null, selectedId: null })
  }

  // Wire up real-time push subscriptions
  let unsubPush: (() => void) | undefined
  if (onSubscribe) {
    unsubPush = onSubscribe((event) => {
      applyPushEvent(event)
    })
  }

  const apiStore: EntityStore<T, TCreate, TUpdate> = {
    get items() { return store.getState().items },
    get isLoading() { return store.getState().isLoading },
    get error() { return store.getState().error },
    get selectedId() { return store.getState().selectedId },
    get selected() {
      const { items, selectedId } = store.getState()
      return items.find((i) => i.id === selectedId) ?? null
    },

    fetch,
    fetchById,
    create,
    update,
    updateField,
    delete: del,
    select,
    clearError,
    applyPushEvent,
    reset,
  }

  return Object.assign(apiStore, {
    subscribe: store.subscribe,
    getState: store.getState,
    setState: store.setState,
  })
}
