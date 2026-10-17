/**
 * A minimal external store — the four primitives `createEntityStore` needs,
 * with the same semantics the store had when it used zustand's vanilla
 * bindings:
 *
 * - `getState()` returns the current state object.
 * - `setState(partial)` shallow-merges a partial; `setState(fn)` merges the
 *   partial the updater returns. `setState(partial, true)` replaces wholesale.
 * - `subscribe(listener)` registers `(state, prevState) => void` and returns
 *   an unsubscribe function.
 *
 * Keeping this in-repo is what makes the package runtime-dependency-free
 * (no zustand, and no framework of any kind), which the sure-* stack's
 * client rules require. It is intentionally tiny and unexported: consumers
 * see the shape through `EntityStoreStore`.
 */

export type StateListener<T> = (state: T, prevState: T) => void

export interface StateStore<T> {
  getState: () => T
  setState: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void
  subscribe: (listener: StateListener<T>) => () => void
}

/** Create a dependency-free external store seeded by `init`. */
export function createStateStore<T extends object>(init: () => T): StateStore<T> {
  let state = init()
  const listeners = new Set<StateListener<T>>()

  return {
    getState: () => state,

    setState: (partial, replace = false) => {
      const next = typeof partial === 'function' ? partial(state) : partial
      if (next === undefined || next === null) return
      const prev = state
      state = replace ? (next as T) : Object.assign({}, state, next)
      // Snapshot before notifying: a listener may unsubscribe during
      // dispatch, and Set iteration tolerates deletion while looping.
      for (const listener of [...listeners]) listener(state, prev)
    },

    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
