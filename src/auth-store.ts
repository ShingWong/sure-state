import type { EntityStore } from './types'
import type { AuthAdapter, Identity } from './auth-types'

export function withAuth<T extends { id: string }, TCreate = Partial<T>, TUpdate = Partial<T>>(
  store: EntityStore<T, TCreate, TUpdate>,
  auth: AuthAdapter,
  getIdentity: () => Promise<Identity | null>,
): EntityStore<T, TCreate, TUpdate> {
  const wrapped = { ...store } as EntityStore<T, TCreate, TUpdate>

  async function check(action: string, entity?: unknown): Promise<boolean> {
    const identity = await getIdentity()
    if (!identity) {
      auth.emit?.('auth:unauthenticated' as any, { action, timestamp: Date.now() } as any)
      return false
    }
    const allowed = await auth.can(identity, action, entity)
    if (!allowed) {
      auth.emit?.('auth:denied' as any, {
        identity, action, entityType: (entity as any)?.id ? 'entity' : undefined,
        reason: 'Policy denied', timestamp: Date.now(),
      } as any)
    }
    return allowed
  }

  const origCreate = store.create.bind(store)
  wrapped.create = async (data: TCreate): Promise<T> => {
    if (!await check('create', data)) {
      const errStore = store as any
      if (errStore.setState) {
        errStore.setState({ error: 'Access denied: insufficient permissions', isLoading: false })
      }
      // Return undefined instead of throwing — errors are communicated via store.error
      return undefined as unknown as T
    }
    return origCreate(data)
  }

  const origUpdate = store.update.bind(store)
  wrapped.update = async (id: string, data: TUpdate): Promise<T> => {
    if (!await check('update', { id, ...data } as any)) {
      const errStore = store as any
      if (errStore.setState) {
        errStore.setState({ error: 'Access denied: insufficient permissions', isLoading: false })
      }
      return undefined as unknown as T
    }
    return origUpdate(id, data)
  }

  const origDelete = store.delete.bind(store)
  wrapped.delete = async (id: string): Promise<void> => {
    if (!await check('delete', { id })) {
      const errStore = store as any
      if (errStore.setState) {
        errStore.setState({ error: 'Access denied: insufficient permissions', isLoading: false })
      }
      return
    }
    return origDelete(id)
  }

  return wrapped
}
