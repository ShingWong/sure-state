import type { PushHandler, PushEvent } from './types'

/**
 * Options for `createWebSocketClient`.
 */
export interface WebSocketClientOptions {
  /** WebSocket server URL (e.g. `wss://example.com/ws`). */
  url: string

  /**
   * Callback invoked when a new access token is needed.
   * The WebSocket sends this token on connect and reconnect.
   */
  getToken: () => string | null

  /**
   * How long (ms) to wait before reconnecting after an unexpected close.
   * @default 3000
   */
  reconnectDelay?: number

  /**
   * Maximum number of consecutive reconnect attempts before giving up.
   * `0` means unlimited.
   * @default 10
   */
  maxReconnectAttempts?: number

  /**
   * Called when the connection state changes.
   */
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'failed') => void
}

/**
 * A WebSocket client that:
 * - Authenticates on connect
 * - Subscribes to entity channels
 * - Auto-reconnects with exponential backoff
 * - Dispatches push events to registered handlers
 */
export interface WebSocketClient {
  /** Subscribe to push events for a specific entity type. */
  subscribe: (entityType: string, handler: PushHandler<any>) => () => void

  /** Connect manually (called automatically on construction). */
  connect: () => void

  /** Disconnect manually. */
  disconnect: () => void

  /** Current connection status. */
  readonly status: 'connecting' | 'connected' | 'disconnected' | 'failed'
}

export function createWebSocketClient(options: WebSocketClientOptions): WebSocketClient {
  const {
    url,
    getToken,
    reconnectDelay = 3000,
    maxReconnectAttempts = 10,
    onStatusChange,
  } = options

  let ws: WebSocket | null = null
  let reconnectCount = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  const handlers = new Map<string, Set<PushHandler<any>>>()
  let _status: WebSocketClient['status'] = 'disconnected'

  function setStatus(status: WebSocketClient['status']) {
    _status = status
    onStatusChange?.(status)
  }

  function getEntityTypeFromPayload(data: any): string | null {
    if (data?.entityType) return data.entityType
    return null
  }

  function dispatchEvent(data: any) {
    const entityType = getEntityTypeFromPayload(data)
    if (!entityType) return

    const event: PushEvent<any> = {
      type: data.type ?? 'updated',
      entity: data.entity,
    }

    const entityHandlers = handlers.get(entityType)
    if (entityHandlers) {
      for (const handler of entityHandlers) {
        try {
          handler(event)
        } catch {
          // handler threw — don't let one bad handler break others
        }
      }
    }
  }

  function connect() {
    if (destroyed) return
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

    setStatus('connecting')

    const token = getToken()
    const wsUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url

    try {
      ws = new WebSocket(wsUrl)
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      reconnectCount = 0
      setStatus('connected')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        dispatchEvent(data)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      setStatus('disconnected')
      ws = null

      if (!destroyed) {
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      // onclose fires immediately after onerror, so reconnect is handled there
    }
  }

  function scheduleReconnect() {
    if (destroyed) return
    if (maxReconnectAttempts > 0 && reconnectCount >= maxReconnectAttempts) {
      setStatus('failed')
      return
    }

    const delay = reconnectDelay * Math.pow(1.5, reconnectCount)
    reconnectCount++

    reconnectTimer = setTimeout(() => {
      connect()
    }, delay)
  }

  function disconnect() {
    destroyed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.onclose = null // prevent reconnect
      ws.close()
      ws = null
    }
    setStatus('disconnected')
  }

  function subscribe(entityType: string, handler: PushHandler<any>): () => void {
    if (!handlers.has(entityType)) {
      handlers.set(entityType, new Set())
    }
    handlers.get(entityType)!.add(handler)

    return () => {
      handlers.get(entityType)?.delete(handler)
    }
  }

  // Auto-connect
  connect()

  return {
    subscribe,
    connect,
    disconnect,
    get status() { return _status },
  }
}
