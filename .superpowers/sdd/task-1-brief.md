### Task 1: Auth Types (`sure-state/src/auth-types.ts`)

**Files:**
- Create: `/usr/local/devel/sure-state/src/auth-types.ts`
- Test: (tested implicitly by Task 2-3)

**Interfaces:**
- Produces: `Identity`, `Session`, `AuthAdapter`, `AuthEvent`, `AuthEventPayload`, `SessionStore` types

- [ ] **Step 1: Create auth-types.ts**

Write the shared type definitions:

```ts
export interface Identity {
  id: string
  roles: string[]
  metadata?: Record<string, unknown>
}

export interface Session {
  identity: Identity
  token: string
  expiresAt: number
}

export interface SessionStore {
  get(token: string): Promise<Session | undefined>
  set(token: string, session: Session): Promise<void>
  delete(token: string): Promise<void>
  cleanup(): Promise<number>
}

export type AuthEventType =
  | 'auth:login' | 'auth:failed' | 'auth:register'
  | 'auth:logout' | 'auth:session_expired'
  | 'auth:denied' | 'auth:unauthenticated'

export interface AuthEventPayload {
  'auth:login': { identity: Identity; ip?: string; timestamp: number }
  'auth:failed': { email?: string; ip?: string; reason: string; consecutiveFailures: number; timestamp: number }
  'auth:register': { identity: Identity; timestamp: number }
  'auth:logout': { identityId: string; timestamp: number }
  'auth:session_expired': { token: string; timestamp: number }
  'auth:denied': { identity: Identity | null; action: string; entityType?: string; reason: string; timestamp: number }
  'auth:unauthenticated': { action: string; timestamp: number }
}

export type AuthEventHandler<E extends AuthEventType> = (payload: AuthEventPayload[E]) => void

export interface AuthAdapter {
  readonly name: string
  login(credentials: Record<string, string>): Promise<Session>
  register(credentials: Record<string, string>): Promise<Session>
  logout(sessionToken: string): Promise<void>
  getSession(sessionToken: string): Promise<Session | null>
  authenticate(token: string): Promise<Identity | null>
  can(identity: Identity, action: string, entity?: unknown): Promise<boolean>
  on: <E extends AuthEventType>(event: E, handler: AuthEventHandler<E>) => () => void
}
```

- [ ] **Step 2: Build and verify**

```bash
cd /usr/local/devel/sure-state && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /usr/local/devel/sure-state && git add src/auth-types.ts && git commit -m "feat: add AuthAdapter, Identity, Session types"
```

---

