import { describe, it, expect, vi } from 'vitest'
import { createEntityStore } from './create-entity-store.js'
import type { PushEvent } from './types.js'

interface Item {
  id: string
  name: string
  version?: number | string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mockApi(items: Item[]) {
  let data = items.map((item) => ({ ...item }))
  const find = (id: string) => data.find((item) => item.id === id)

  return {
    list: vi.fn(async () => data.map((item) => ({ ...item }))),
    getById: vi.fn(async (id: string) => {
      const item = find(id)
      if (!item) throw new Error('Not found')
      return { ...item }
    }),
    create: vi.fn(async (partial: Partial<Item>) => {
      const created = { id: 'new', name: '', ...partial, version: 1 } as Item
      data.push(created)
      return { ...created }
    }),
    update: vi.fn(async (id: string, updates: Partial<Item>) => {
      const item = find(id)
      if (!item) throw new Error('Not found')
      Object.assign(item, updates)
      return { ...item }
    }),
    updateField: vi.fn(async (id: string, field: keyof Item, value: unknown, _version?: number | string) => {
      const item = find(id)
      if (!item) throw new Error('Not found')
      ;(item as any)[field] = value
      return { ...item }
    }),
    remove: vi.fn(async (id: string) => {
      data = data.filter((item) => item.id !== id)
    }),
  }
}

describe('field-level mutations', () => {
  it('sends only the mutated slot through api.updateField with the cached version', async () => {
    const api = mockApi([{ id: '1', name: 'Alice', version: 3 }])
    const store = createEntityStore<Item>({ name: 'items', api, versioning: true })
    await store.fetch()

    const updated = await store.updateField('1', 'name', 'Bob')

    expect(api.updateField).toHaveBeenCalledWith('1', 'name', 'Bob', 3)
    expect(api.update).not.toHaveBeenCalled()
    expect(updated.name).toBe('Bob')
    expect(store.items[0]?.name).toBe('Bob')
  })

  it('falls back to a scalar update payload when no dedicated endpoint exists', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const { updateField: _unused, ...bulkApi } = api
    const store = createEntityStore<Item>({ name: 'items', api: bulkApi })
    await store.fetch()

    await store.updateField('1', 'name', 'Bob')

    expect(api.update).toHaveBeenCalledWith('1', { name: 'Bob' })
    expect(store.items[0]?.name).toBe('Bob')
  })

  it('prefers the config-level field endpoint when supplied', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const configUpdateField = vi.fn(async (_id: string, _field: keyof Item, _value: unknown) =>
      ({ id: '1', name: 'FromConfig', version: 2 } as Item))
    const store = createEntityStore<Item>({ name: 'items', api, updateField: configUpdateField })
    await store.fetch()

    await store.updateField('1', 'name', 'Bob')

    expect(configUpdateField).toHaveBeenCalledWith('1', 'name', 'Bob', undefined)
    expect(api.updateField).not.toHaveBeenCalled()
    expect(store.items[0]?.name).toBe('FromConfig')
  })

  it('emits MutationEvent with the exact field delta', async () => {
    const onMutate = vi.fn()
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const store = createEntityStore<Item>({ name: 'items', api, onMutate })

    await store.updateField('1', 'name', 'Bob')

    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'updated', field: 'name', value: 'Bob', entity: expect.objectContaining({ name: 'Bob' }),
    }))
  })

  it('discards an out-of-order field response (mutation generation fencing)', async () => {
    const api = mockApi([{ id: '1', name: 'Alice', version: 1 }])
    const first = deferred<Item>()
    const second = deferred<Item>()
    api.updateField
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const store = createEntityStore<Item>({ name: 'items', api, versioning: true })
    await store.fetch()

    const older = store.updateField('1', 'name', 'Old')
    const newer = store.updateField('1', 'name', 'New')

    second.resolve({ id: '1', name: 'New', version: 2 })
    await newer
    first.resolve({ id: '1', name: 'Old', version: 2 })
    await older

    expect(store.items[0]?.name).toBe('New')
    expect(store.isLoading).toBe(false)
  })

  it('rejects a stale version on a client-first bulk update', async () => {
    const api = mockApi([{ id: '1', name: 'Alice', version: 5 }])
    api.update.mockResolvedValueOnce({ id: '1', name: 'Stale', version: 4 })
    const store = createEntityStore<Item>({ name: 'items', api, versioning: true })
    await store.fetch()

    await store.update('1', { name: 'Stale' })

    expect(store.items[0]).toEqual({ id: '1', name: 'Alice', version: 5 })
  })

  it('rejects a stale version on a client-first field update', async () => {
    const api = mockApi([{ id: '1', name: 'Alice', version: 5 }])
    api.updateField.mockResolvedValueOnce({ id: '1', name: 'Stale', version: 4 })
    const store = createEntityStore<Item>({ name: 'items', api, versioning: true })
    await store.fetch()

    await store.updateField('1', 'name', 'Stale')

    expect(store.items[0]).toEqual({ id: '1', name: 'Alice', version: 5 })
  })

  it('fences stale push updates and accepts newer ones', async () => {
    const api = mockApi([{ id: '1', name: 'Alice', version: 5 }])
    const onMutate = vi.fn()
    const store = createEntityStore<Item>({ name: 'items', api, versioning: true, onMutate })
    await store.fetch()

    store.applyPushEvent({ type: 'updated', entity: { id: '1', name: 'OldPush', version: 4 } })
    expect(store.items[0]?.name).toBe('Alice')

    store.applyPushEvent({ type: 'updated', entity: { id: '1', name: 'NewPush', version: 6 }, field: 'name' })
    expect(store.items[0]?.name).toBe('NewPush')
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ field: 'name', value: 'NewPush' }))
  })

  it('supports string versions via versionSelector', async () => {
    const api = mockApi([{ id: '1', name: 'Alice', version: 'v2' }])
    const store = createEntityStore<Item>({ name: 'items', api, versioning: true })
    await store.fetch()

    store.applyPushEvent({ type: 'updated', entity: { id: '1', name: 'Old', version: 'v1' } })
    expect(store.items[0]?.name).toBe('Alice')

    store.applyPushEvent({ type: 'updated', entity: { id: '1', name: 'Fresh', version: 'v3' } })
    expect(store.items[0]?.name).toBe('Fresh')
  })

  it('supersedes an in-flight local mutation when a push arrives', async () => {
    const api = mockApi([{ id: '1', name: 'Alice', version: 1 }])
    const local = deferred<Item>()
    api.updateField.mockImplementationOnce(() => local.promise)
    const store = createEntityStore<Item>({ name: 'items', api })
    await store.fetch()

    const pending = store.updateField('1', 'name', 'Local')
    const event: PushEvent<Item> = { type: 'updated', entity: { id: '1', name: 'Pushed', version: 2 } }
    store.applyPushEvent(event)
    local.resolve({ id: '1', name: 'Local', version: 2 })
    await pending

    expect(store.items[0]?.name).toBe('Pushed')
  })

  it('keeps stale mutation errors from polluting store.error', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const first = deferred<Item>()
    const second = deferred<Item>()
    api.updateField
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const store = createEntityStore<Item>({ name: 'items', api })

    const older = store.updateField('1', 'name', 'Old')
    const newer = store.updateField('1', 'name', 'New')
    second.resolve({ id: '1', name: 'New' })
    await newer
    first.reject(new Error('late failure'))
    await expect(older).rejects.toThrow('late failure')

    expect(store.error).toBeNull()
  })

  it('does not apply mutations after reset because generations are cleared', async () => {
    const api = mockApi([{ id: '1', name: 'Alice' }])
    const pending = deferred<Item>()
    api.updateField.mockImplementationOnce(() => pending.promise)
    const store = createEntityStore<Item>({ name: 'items', api })

    const operation = store.updateField('1', 'name', 'Bob')
    store.reset()
    pending.resolve({ id: '1', name: 'Bob' })
    await operation

    expect(store.items).toEqual([])
  })
})
