import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  EntityStore,
  EntityStoreConfig,
  PushEvent,
} from './types'

interface InternalState<T> {
  items: T[]
  isLoading: boolean
  error: string | null
  selectedId: string | null
}

export function createEntityStore<T extends { id: string }, TCreate = Partial<T>, TUpdate = Partial<T>>(
  config: EntityStoreConfig<T, TCreate, TUpdate>,
): EntityStore<T, TCreate, TUpdate> & Pick<StoreApi<InternalState<T>>, 'subscribe' | 'getState' | 'setState'> {
  const {
    name,
    sync = 'client-first',
    api,
    onSubscribe,
    versioning = false,
    versionSelector = (e: any) => e?.version,
    onMutate,
  } = config

  const store = createStore<InternalState<T>>(() => ({
    items: [],
    isLoading: false,
    error: null,
    selectedId: null,
  }))

  function setLoading() {
    store.setState({ isLoading: true, error: null })
  }

  function setError(error: string | null) {
    store.setState({ isLoading: false, error })
  }

  function pushItems(items: T[]) {
    store.setState({ items, isLoading: false })
  }

  /** Replace the local items list with fresh data from the server. */
  async function fetch(): Promise<void> {
    setLoading()
    try {
      const items = await api.list()
      pushItems(items)
    } catch (err: any) {
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

      onMutate?.({ kind: 'created', entity: created })
      return created
    } catch (err: any) {
      setError(err?.message ?? `Failed to create ${name}`)
      throw err
    }
  }

  async function update(id: string, data: TUpdate): Promise<T> {
    setLoading()
    try {
      const updated = await api.update(id, data)

      if (sync === 'client-first') {
        store.setState((s) => ({
          items: s.items.map((item) => (item.id === id ? updated : item)),
          isLoading: false,
        }))
      } else {
        await fetch()
      }

      onMutate?.({ kind: 'updated', entity: updated })
      return updated
    } catch (err: any) {
      setError(err?.message ?? `Failed to update ${name}`)
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

      onMutate?.({ kind: 'deleted', id })
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
    const { type, entity } = event

    store.setState((s) => {
      switch (type) {
        case 'created':
          return { items: [entity, ...s.items] }
        case 'updated':
          return {
            items: s.items.map((item) =>
              item.id === entity.id ? entity : item,
            ),
          }
        case 'deleted':
          return {
            items: s.items.filter((item) => item.id !== entity.id),
            selectedId:
              s.selectedId === entity.id ? null : s.selectedId,
          }
      }
    })

    onMutate?.({ kind: type, entity })
  }

  function reset() {
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
