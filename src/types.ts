/** How the store reconciles local state with the server. */
export type SyncStrategy = 'client-first' | 'server-first'

/**
 * Configuration passed to `createEntityStore`.
 *
 * @typeParam T - The entity type (e.g. `Persona`, `Session`).
 * @typeParam TCreate - Shape of the create payload (defaults to `Partial<T>`).
 * @typeParam TUpdate - Shape of the update payload (defaults to `Partial<T>`).
 */
export interface EntityStoreConfig<T, TCreate = Partial<T>, TUpdate = Partial<T>> {
  /** Human-readable entity name (used for error messages, logging). */
  name: string

  /**
   * Where the source of truth lives.
   * - `'client-first'`  — Optimistic local updates, re-fetch after write.
   *                       Safe when the current user is the only writer.
   * - `'server-first'`  — Never trust local state after a mutation.
   *                       Always re-fetch. Required for shared/collaborative entities.
   * @default 'client-first'
   */
  sync?: SyncStrategy

  /**
   * API adapter. The store calls these methods; you wire them to your HTTP client.
   */
  api: EntityApi<T, TCreate, TUpdate>

  /**
   * Subscribe to real-time push events for this entity type.
   * Called once when the store initialises. Return an unsubscribe function.
   */
  onSubscribe?: (handler: PushHandler<T>) => () => void

  /**
   * Enable version-stamp optimistic concurrency control.
   * When `true`, every write must include the entity's current `version`,
   * and the server rejects writes where `version` is stale.
   * @default false
   */
  versioning?: boolean

  /**
   * Selector to extract the version field from an entity (default: `e => (e as any).version`).
   * Only used when `versioning: true`.
   */
  versionSelector?: (entity: T) => number | string | undefined

  /**
   * Called after every successful write mutation (create / update / delete).
   * Use this to invalidate query caches, show toasts, etc.
   */
  onMutate?: (event: MutationEvent<T>) => void
}

/** API adapter the store calls for CRUD operations. */
export interface EntityApi<T, TCreate = Partial<T>, TUpdate = Partial<T>> {
  list: () => Promise<T[]>
  getById: (id: string) => Promise<T>
  create: (data: TCreate) => Promise<T>
  update: (id: string, data: TUpdate) => Promise<T>
  remove: (id: string) => Promise<void>
}

/** Shape of a push event received via WebSocket. */
export interface PushEvent<T> {
  type: 'created' | 'updated' | 'deleted'
  entity: T
}

/** Handler registered by the store to process incoming push events. */
export type PushHandler<T> = (event: PushEvent<T>) => void

/** Events emitted after successful mutations. */
export interface MutationEvent<T> {
  kind: 'created' | 'updated' | 'deleted'
  entity?: T
  id?: string
}

/** Public interface of a store created by `createEntityStore`. */
export interface EntityStore<T, TCreate, TUpdate> {
  /** Reactive state. */
  readonly items: T[]
  readonly isLoading: boolean
  readonly error: string | null
  readonly selectedId: string | null
  readonly selected: T | null

  /** Fetch all entities from the server (replaces local list). */
  fetch: () => Promise<void>

  /** Fetch a single entity by ID. */
  fetchById: (id: string) => Promise<void>

  /** Create an entity on the server, then re-fetch the list. */
  create: (data: TCreate) => Promise<T>

  /** Update an entity on the server, then re-fetch the list. */
  update: (id: string, data: TUpdate) => Promise<T>

  /** Delete an entity on the server, then re-fetch the list. */
  delete: (id: string) => Promise<void>

  /** Select an entity by ID (local only — for detail views). */
  select: (id: string | null) => void

  /** Clear error state. */
  clearError: () => void

  /** Apply a push event (called by the WebSocket handler internally). */
  applyPushEvent: (event: PushEvent<T>) => void

  /** Reset to initial state. */
  reset: () => void
}

/**
 * Version-stamp metadata for optimistic concurrency control.
 * Attach to every write payload when `versioning: true`.
 */
export interface Versioned {
  /** Monotonically increasing version number. */
  version: number
}
