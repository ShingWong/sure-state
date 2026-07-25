import type { EntityStore } from './types'
import type { Inspector, InspectorReport } from './inspector'
import type { MetricsCollector } from './instrumentation'

export interface AgentTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

export interface AgentToolsConfig {
  stores?: Record<string, EntityStore<any, any, any>>
  inspectors?: Record<string, Inspector>
  metricsCollector?: MetricsCollector
}

function flattenForOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(flattenForOutput)
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'function' || k.startsWith('_')) continue
      result[k] = flattenForOutput(v)
    }
    return result
  }
  return value
}

export function createAgentTools(config: AgentToolsConfig): AgentTool[] {
  const tools: AgentTool[] = []

  tools.push({
    name: 'list_stores',
    description: 'List all registered stores with current status (items count, loading, error, selection)',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      if (!config.stores) return { stores: [] }
      const entries = Object.entries(config.stores).map(([name, store]) => ({
        name,
        itemsCount: store.items?.length ?? 0,
        isLoading: store.isLoading ?? false,
        error: store.error ?? null,
        selectedId: store.selectedId ?? null,
      }))
      return { stores: entries }
    },
  })

  tools.push({
    name: 'get_store_state',
    description: 'Get the full state snapshot for a specific store, including all items',
    inputSchema: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Name of the store to inspect' },
      },
      required: ['store'],
    },
    handler: async (args) => {
      const name = args.store as string
      const store = config.stores?.[name]
      if (!store) throw new Error(`Store "${name}" not found. Available stores: ${Object.keys(config.stores ?? {}).join(', ') || 'none'}`)
      return {
        name,
        items: flattenForOutput(store.items),
        isLoading: store.isLoading,
        error: store.error,
        selectedId: store.selectedId,
        selected: store.selected ? flattenForOutput(store.selected) : null,
      }
    },
  })

  tools.push({
    name: 'get_action_history',
    description: 'Get recent action history for a store (actions like fetch, create, update, delete with timing)',
    inputSchema: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Name of the store' },
        limit: { type: 'number', description: 'Maximum number of actions to return (default 50)' },
      },
      required: ['store'],
    },
    handler: async (args) => {
      const name = args.store as string
      const inspector = config.inspectors?.[name]
      if (!inspector) throw new Error(`No inspector for store "${name}". Available inspectors: ${Object.keys(config.inspectors ?? {}).join(', ') || 'none'}`)
      const limit = (args.limit as number) || 50
      const actions = inspector.getActions()
      return {
        store: name,
        totalActions: actions.length,
        actions: actions.slice(-limit).reverse(),
      }
    },
  })

  tools.push({
    name: 'dump_report',
    description: 'Get a comprehensive debug report for one or all stores (state summary + recent actions)',
    inputSchema: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Store name (omit for all stores)' },
      },
    },
    handler: async (args) => {
      const target = args.store as string | undefined

      if (target) {
        const store = config.stores?.[target]
        const inspector = config.inspectors?.[target]
        const report: Record<string, unknown> = {
          name: target,
          state: store
            ? {
                itemsCount: store.items?.length ?? 0,
                isLoading: store.isLoading,
                error: store.error,
                selectedId: store.selectedId,
              }
            : 'Store not found',
        }
        if (inspector) {
          report.actions = inspector.getActions().slice(-20).reverse()
        }
        return report
      }

      const reports: Record<string, unknown> = {}
      for (const [name, store] of Object.entries(config.stores ?? {})) {
        const inspector = config.inspectors?.[name]
        const entry: Record<string, unknown> = {
          itemsCount: store.items?.length ?? 0,
          isLoading: store.isLoading,
          error: store.error,
        }
        if (inspector) {
          entry.recentActions = inspector.getActions().slice(-10).reverse()
        }
        reports[name] = entry
      }
      return { stores: reports }
    },
  })

  tools.push({
    name: 'get_metrics',
    description: 'Get current metrics snapshot (Prometheus-style counts and gauges)',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const collector = config.metricsCollector
      if (!collector) return { metrics: 'No metrics collector configured' }

      return { metrics: collector.dump() }
    },
  })

  return tools
}
