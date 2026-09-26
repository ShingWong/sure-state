export { createEntityStore } from './create-entity-store.js'
export { createWebSocketClient } from './websocket.js'
export { createTokenManager, type TokenManager, type TokenPair, type TokenManagerOptions } from './auth.js'
export { getVersion, stampFor, versionWhere, ConflictError } from './version-stamp.js'
export { createInspector } from './inspector.js'
export { attachLogger } from './logger.js'
export { createMockApi, waitForStore, recordActions, createTestStore } from './test-utils.js'
export { createSimpleAuth } from './auth-builtin.js'
export { withAuth } from './auth-store.js'
export type { AuthAdapter, Identity, Session, SessionStore, AuthEventType, AuthEventPayload, AuthEventHandler } from './auth-types.js'
export type { SimpleAuthOptions } from './auth-builtin.js'
export { createEventBus } from './events.js'
export { createMetricsCollector, attachMetrics, attachOtelSpans } from './instrumentation.js'
export { createAgentTools, type AgentTool, type AgentToolsConfig } from './agent-tools.js'
export { createMcpServer } from './create-mcp-server.js'
export { createCookieStore, syncToCookie } from './cookie-store.js'
export type { CookieStore, CookieStoreOptions, SyncToCookieOptions } from './cookie-store.js'
export type { Inspector, InspectorReport, ActionRecord } from './inspector.js'
export type { LoggerOptions } from './logger.js'
export type { MockEntity } from './test-utils.js'
export type { MetricsCollector } from './instrumentation.js'
export type { StoreEventBus, StoreEventType, StoreEventPayload, StoreEventHandler } from './events.js'

export type {
  SyncStrategy,
  EntityStoreConfig,
  EntityApi,
  PushEvent,
  PushHandler,
  MutationEvent,
  EntityStore,
  Versioned,
} from './types.js'
