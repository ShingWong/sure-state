import { describe, it, expect, vi } from 'vitest'
import { createStateStore } from './store.js'
import { createEntityStore } from './create-entity-store.js'

interface State {
  count: number
  label: string
}

describe('createStateStore (dependency-free external store)', () => {
  it('seeds state lazily and reads it back', () => {
    const init = vi.fn(() => ({ count: 0, label: 'a' }))
    const store = createStateStore<State>(init)
    expect(init).toHaveBeenCalledTimes(1)
    expect(store.getState()).toEqual({ count: 0, label: 'a' })
  })

  it('shallow-merges a partial without mutating the previous state', () => {
    const store = createStateStore<State>(() => ({ count: 0, label: 'a' }))
    const before = store.getState()
    store.setState({ count: 1 })
    expect(store.getState()).toEqual({ count: 1, label: 'a' })
    expect(before).toEqual({ count: 0, label: 'a' })
    expect(store.getState()).not.toBe(before)
  })

  it('accepts an updater function', () => {
    const store = createStateStore<State>(() => ({ count: 1, label: 'a' }))
    store.setState((s) => ({ count: s.count + 41 }))
    expect(store.getState().count).toBe(42)
  })

  it('replaces wholesale when asked', () => {
    const store = createStateStore<State>(() => ({ count: 1, label: 'a' }))
    // `replace` mirrors zustand's second argument: no merge, no leftovers.
    store.setState({ count: 2, label: 'b' }, true)
    expect(store.getState()).toEqual({ count: 2, label: 'b' })
  })

  it('notifies subscribers with (state, prevState) and stops after unsubscribe', () => {
    const store = createStateStore<State>(() => ({ count: 0, label: 'a' }))
    const seen: Array<[State, State]> = []
    const unsub = store.subscribe((state, prev) => seen.push([state, prev]))

    store.setState({ count: 1 })
    expect(seen).toHaveLength(1)
    const first = seen[0]
    if (!first) throw new Error('expected one notification')
    const [state, prev] = first
    expect(state.count).toBe(1)
    expect(prev.count).toBe(0)

    unsub()
    store.setState({ count: 2 })
    expect(seen).toHaveLength(1)
  })

  it('survives a listener unsubscribing itself during dispatch', () => {
    const store = createStateStore<State>(() => ({ count: 0, label: 'a' }))
    const other = vi.fn()
    const once = vi.fn(() => unsub())
    const unsub = store.subscribe(once)
    store.subscribe(other)

    store.setState({ count: 1 })
    expect(once).toHaveBeenCalledTimes(1)
    expect(other).toHaveBeenCalledTimes(1)

    store.setState({ count: 2 })
    expect(once).toHaveBeenCalledTimes(1)
    expect(other).toHaveBeenCalledTimes(2)
  })
})

describe('createEntityStore exposes the store surface with no external deps', () => {
  it('reports state and pushes updates to subscribers', async () => {
    const store = createEntityStore<{ id: string }, { id: string }, Partial<{ id: string }>>({
      name: 'thing',
      api: {
        list: async () => [{ id: '1' }],
        getById: async (id) => ({ id }),
        create: async (d) => d,
        update: async (id) => ({ id }),
        remove: async () => {},
      },
    })

    expect(store.getState()).toEqual({ items: [], isLoading: false, error: null, selectedId: null })

    const updates: number[] = []
    const unsub = store.subscribe((state) => updates.push(state.items.length))

    await store.fetch()
    expect(store.items.map((i) => i.id)).toEqual(['1'])
    expect(updates.at(-1)).toBe(1)

    store.select('1')
    expect(store.selected).toEqual({ id: '1' })

    store.reset()
    expect(store.items).toEqual([])
    unsub()
  })
})
