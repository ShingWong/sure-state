import { describe, it, expect, vi } from 'vitest'
import { createEntityStore } from './create-entity-store'
import { createInspector } from './inspector'

interface Item {
  id: string
  name: string
  version?: number
}

function mockApi(items: Item[] = [], errorConfig?: { failList?: boolean; failCreate?: boolean; failUpdate?: boolean; failRemove?: boolean; errorMessage?: string }) {
  let data = [...items]
  let nextId = data.length + 1
  const { failList, failCreate, failUpdate, failRemove, errorMessage = 'Simulated error' } = errorConfig ?? {}

  function maybeFail(flag?: boolean) {
    if (flag) throw new Error(errorMessage)
  }

  return {
    list: vi.fn(async () => {
      maybeFail(failList)
      return [...data]
    }),
    getById: vi.fn(async (id: string) => {
      maybeFail(failList)
      const item = data.find((d) => d.id === id)
      if (!item) throw new Error('Not found')
      return { ...item }
    }),
    create: vi.fn(async (item: Partial<Item>) => {
      maybeFail(failCreate)
      const created = { ...item, id: String(nextId++), version: 1 } as Item
      data.push(created)
      return { ...created }
    }),
    update: vi.fn(async (id: string, updates: Partial<Item>) => {
      maybeFail(failUpdate)
      const idx = data.findIndex((d) => d.id === id)
      if (idx === -1) throw new Error('Not found')
      data[idx] = { ...data[idx], ...updates, version: (data[idx]?.version ?? 0) + 1 } as Item
      return { ...data[idx] }
    }),
    remove: vi.fn(async (id: string) => {
      maybeFail(failRemove)
      data = data.filter((d) => d.id !== id)
    }),
  }
}

describe('createEntityStore', () => {
  it('fetches items and populates the store', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }])
    const store = createEntityStore<Item>({ name: 'test', api })

    expect(store.items).toHaveLength(0)
    expect(store.isLoading).toBe(false)

    const fetchPromise = store.fetch()
    expect(store.isLoading).toBe(true) // immediate loading state

    await fetchPromise
    expect(store.items).toHaveLength(2)
    expect(store.isLoading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('selects an item', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api })
    await store.fetch()

    store.select('1')
    expect(store.selectedId).toBe('1')
    expect(store.selected?.name).toBe('Alice')

    store.select(null)
    expect(store.selectedId).toBeNull()
    expect(store.selected).toBeNull()
  })

  it('creates an item (client-first)', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api, sync: 'client-first' })

    await store.fetch()
    expect(store.items).toHaveLength(1)

    await store.create({ name: 'Bob' })
    expect(store.items).toHaveLength(2) // optimistic insert
    expect(store.items[0]?.name).toBe('Bob')
  })

  it('creates an item (server-first) and re-fetches', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api, sync: 'server-first' })

    await store.fetch()
    expect(store.items).toHaveLength(1)

    await store.create({ name: 'Bob' })
    // server-first calls list() after create
    expect(api.list).toHaveBeenCalledTimes(2) // initial fetch + refetch
    expect(store.items).toHaveLength(2)
  })

  it('updates an item (client-first)', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api, sync: 'client-first' })
    await store.fetch()

    await store.update('1', { name: 'Updated Alice' })
    expect(store.items[0]?.name).toBe('Updated Alice')
    expect(store.items).toHaveLength(1)
  })

  it('deletes an item (client-first)', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }])
    const store = createEntityStore<Item>({ name: 'test', api, sync: 'client-first' })
    await store.fetch()
    expect(store.items).toHaveLength(2)

    await store.delete('1')
    expect(store.items).toHaveLength(1)
    expect(store.items[0]?.id).toBe('2')
  })

  it('deletes an item (server-first) and re-fetches', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }])
    const store = createEntityStore<Item>({ name: 'test', api, sync: 'server-first' })
    await store.fetch()

    await store.delete('1')
    // server-first re-fetches after delete
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('clears selectedId when selected item is deleted', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api, sync: 'client-first' })
    await store.fetch()
    store.select('1')
    expect(store.selectedId).toBe('1')

    await store.delete('1')
    expect(store.selectedId).toBeNull()
    expect(store.selected).toBeNull()
  })

  it('sets error on failure', async () => {
    const api = mockApi([], { failList: true, errorMessage: 'DB down' })
    const store = createEntityStore<Item>({ name: 'test', api })

    await expect(store.fetch()).rejects.toThrow('DB down')
    expect(store.error).toBe('DB down')
    expect(store.isLoading).toBe(false)

    store.clearError()
    expect(store.error).toBeNull()
  })

  it('emits onMutate callbacks', async () => {
    const onMutate = vi.fn()
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api, onMutate })
    await store.fetch()

    await store.create({ name: 'Bob' })
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'created' }))

    await store.update('1', { name: 'Changed' })
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'updated' }))

    await store.delete('1')
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'deleted' }))
  })
})

describe('inspector', () => {
  it('records actions with timing', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api })
    const inspector = createInspector(store)

    await store.fetch()
    await store.create({ name: 'Bob' })

    const actions = inspector.getActions()
    expect(actions.length).toBeGreaterThanOrEqual(2)

    const fetchAction = actions.find((a) => a.kind === 'fetch')
    expect(fetchAction).toBeDefined()
    expect(fetchAction!.success).toBe(true)
    expect(fetchAction!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('dump returns current state summary', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api })
    const inspector = createInspector(store)
    await store.fetch()

    const dump = inspector.dump()
    expect(dump.itemsCount).toBe(1)
    expect(dump.isLoading).toBe(false)
    expect(dump.error).toBeNull()
    expect(dump.actionCount).toBeGreaterThanOrEqual(1)
  })

  it('dump includes error state', async () => {
    const api = mockApi([], { failList: true })
    const store = createEntityStore<Item>({ name: 'test', api })
    const inspector = createInspector(store)

    await expect(store.fetch()).rejects.toThrow()
    const dump = inspector.dump()
    expect(dump.error).toBeTruthy()
  })

  it('onAction notifies listeners', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api })
    const inspector = createInspector(store)
    const listener = vi.fn()
    inspector.onAction(listener)

    await store.fetch()
    expect(listener).toHaveBeenCalled()
    expect(listener.mock.calls[0]?.[0]?.kind).toBe('fetch')
  })

  it('clears history', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api })
    const inspector = createInspector(store)
    await store.fetch()
    expect(inspector.getActions().length).toBeGreaterThan(0)

    inspector.clear()
    expect(inspector.getActions()).toHaveLength(0)
  })

  it('setLogging(true/false) controls recording', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'test', api })
    const inspector = createInspector(store)
    inspector.setLogging(false)

    await store.fetch()
    expect(inspector.getActions()).toHaveLength(0)

    inspector.setLogging(true)
    await store.create({ name: 'Bob' })
    expect(inspector.getActions().length).toBeGreaterThanOrEqual(1)
  })
})
