/**
 * Browser/edge entry point — the part of sure-state that is safe to bundle
 * for a client: the entity store and its types.
 *
 * The main entry (`@shing.wong/sure-state`) is the Node/full surface and
 * pulls in Node-only modules (`create-mcp-server` -> `readline`,
 * `auth-builtin` -> `crypto`). Importing that from a browser bundle fails to
 * build, so client code (browsers, extensions, the sure-* app shells) should
 * import from `@shing.wong/sure-state/core` instead:
 *
 * ```ts
 * import { createEntityStore } from '@shing.wong/sure-state/core'
 * ```
 *
 * This entry has no runtime dependencies and no Node builtins.
 */
export { createEntityStore } from './create-entity-store.js'
export type {
  EntityApi,
  EntityStore,
  EntityStoreConfig,
  EntityStoreState,
  EntityStoreStore,
  MutationEvent,
  PushEvent,
  PushHandler,
  SyncStrategy,
  Versioned,
} from './types.js'
