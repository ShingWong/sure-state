import type { Versioned } from './types'

/**
 * Extract the version number from an entity, defaulting to `0` if absent.
 */
export function getVersion(entity: unknown, selector?: (e: any) => number | string | undefined): number {
  const raw = selector ? selector(entity) : (entity as any)?.version
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') {
    const parsed = parseInt(raw, 10)
    return isNaN(parsed) ? 0 : parsed
  }
  return 0
}

/**
 * Create a `Versioned` payload for a write mutation.
 * Attach the result to your update payload so the server can verify
 * the client isn't overwriting a newer version.
 *
 * @example
 * ```ts
 * const stamp = stampFor(existingEntity)
 * await api.update(id, { ...changes, ...stamp })
 * ```
 */
export function stampFor(entity: Versioned | { version?: number }, selector?: (e: any) => number | string | undefined): Versioned {
  return { version: getVersion(entity, selector) }
}

/**
 * Build a `WHERE version = :expected` clause for SQL queries.
 *
 * @example
 * ```ts
 * const stamp = stampFor(clientEntity)
 * const result = await sql`
 *   UPDATE "Persona" SET ... WHERE id = ${id} AND version = ${stamp.version}
 *   RETURNING *
 * `
 * if (result.length === 0) throw new ConflictError('Entity was modified by another user')
 * ```
 */
export function versionWhere(stamp: Versioned): string {
  return `version = ${stamp.version}`
}

/**
 * Error thrown when an optimistic concurrency check fails
 * (the entity was modified by another writer between read and write).
 */
export class ConflictError extends Error {
  public readonly code = 'CONFLICT'
  public readonly statusCode = 409

  constructor(entityName = 'Entity') {
    super(`${entityName} was modified by another user. Please refresh and try again.`)
    this.name = 'ConflictError'
  }
}
