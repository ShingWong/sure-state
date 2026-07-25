import { describe, it, expect, vi } from 'vitest'
import { createEntityStore } from './create-entity-store'
import { createInspector } from './inspector'
import { createAgentTools } from './agent-tools'
import { createMcpServer } from './create-mcp-server'
import { type AgentTool } from './agent-tools'
import { EventEmitter } from 'events'
import { Writable } from 'stream'
import type { EntityApi } from './types'

interface Item {
  id: string
  name: string
}

function mockApi(items: Item[] = []): EntityApi<Item, Partial<Item>, Partial<Item>> {
  let data: Item[] = [...items]
  let nextId = data.length + 1
  return {
    list: async () => [...data],
    getById: async (id: string) => {
      const item = data.find((d) => d.id === id)
      if (!item) throw new Error('Not found')
      return { ...item }
    },
    create: async (partial: Partial<Item>) => {
      const name: string = partial.name ?? 'new-item'
      const created: Item = { id: String(nextId++), name }
      data.push(created)
      return { ...created }
    },
    update: async (id: string, updates: Partial<Item>) => {
      const idx = data.findIndex((d) => d.id === id)
      if (idx === -1) throw new Error('Not found')
      const existing = data[idx]!
      data[idx] = { ...existing, ...updates, id: existing.id }
      return { ...(data[idx]!) }
    },
    remove: async (id: string) => {
      data = data.filter((d) => d.id !== id)
    },
  }
}

describe('agent tools', () => {
  describe('createAgentTools', () => {
    it('returns list_stores tool that reports empty when no stores', async () => {
      const tools = createAgentTools({})
      const listTool = tools.find((t) => t.name === 'list_stores')!
      const result = await listTool.handler({})
      expect(result).toEqual({ stores: [] })
    })

    it('list_stores reports store status', async () => {
      const store = createEntityStore<Item>({ name: 'test', api: mockApi() })
      const tools = createAgentTools({ stores: { test: store } })
      const listTool = tools.find((t) => t.name === 'list_stores')!
      const result = await listTool.handler({}) as any
      expect(result.stores).toHaveLength(1)
      expect(result.stores[0].name).toBe('test')
      expect(result.stores[0].itemsCount).toBe(0)
      expect(result.stores[0].isLoading).toBe(false)
      expect(result.stores[0].error).toBeNull()
    })

    it('get_store_state returns full state', async () => {
      const api = mockApi([{ id: '1', name: 'Alpha' }])
      const store = createEntityStore<Item>({ name: 'test', api })
      await store.fetch()

      const tools = createAgentTools({ stores: { test: store } })
      const tool = tools.find((t) => t.name === 'get_store_state')!
      const result = await tool.handler({ store: 'test' }) as any

      expect(result.name).toBe('test')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('Alpha')
      expect(result.isLoading).toBe(false)
    })

    it('get_store_state errors on unknown store', async () => {
      const tools = createAgentTools({})
      const tool = tools.find((t) => t.name === 'get_store_state')!
      await expect(tool.handler({ store: 'missing' })).rejects.toThrow('Store "missing" not found')
    })

    it('get_action_history returns recent actions', async () => {
      const store = createEntityStore<Item>({ name: 'test', api: mockApi() })
      const inspector = createInspector(store)
      await store.fetch()

      const tools = createAgentTools({
        stores: { test: store },
        inspectors: { test: inspector },
      })

      const tool = tools.find((t) => t.name === 'get_action_history')!
      const result = await tool.handler({ store: 'test' }) as any

      expect(result.store).toBe('test')
      expect(result.totalActions).toBeGreaterThanOrEqual(1)
      expect(result.actions[0].kind).toBe('fetch')
    })

    it('get_action_history errors without inspector', async () => {
      const store = createEntityStore<Item>({ name: 'test', api: mockApi() })
      const tools = createAgentTools({ stores: { test: store } })
      const tool = tools.find((t) => t.name === 'get_action_history')!
      await expect(tool.handler({ store: 'test' })).rejects.toThrow('No inspector for store "test"')
    })

    it('dump_report returns comprehensive report for all stores', async () => {
      const store = createEntityStore<Item>({ name: 'test', api: mockApi() })
      const inspector = createInspector(store)
      await store.fetch()

      const tools = createAgentTools({
        stores: { test: store },
        inspectors: { test: inspector },
      })

      const tool = tools.find((t) => t.name === 'dump_report')!
      const result = await tool.handler({}) as any

      expect(result.stores).toBeDefined()
      expect(result.stores.test).toBeDefined()
      expect(result.stores.test.itemsCount).toBe(0)
      expect(result.stores.test.recentActions).toBeDefined()
    })

    it('dump_report targets a single store', async () => {
      const store = createEntityStore<Item>({ name: 'test', api: mockApi() })
      await store.fetch()

      const tools = createAgentTools({ stores: { test: store } })
      const tool = tools.find((t) => t.name === 'dump_report')!
      const result = await tool.handler({ store: 'test' }) as any

      expect(result.name).toBe('test')
      expect(result.state.itemsCount).toBe(0)
    })

    it('provides all expected tool names', () => {
      const tools = createAgentTools({})
      const names = tools.map((t) => t.name).sort()
      expect(names).toEqual([
        'dump_report',
        'get_action_history',
        'get_metrics',
        'get_store_state',
        'list_stores',
      ])
    })
  })

  describe('createMcpServer', () => {
    it('handles initialize, tools/list, and tools/call', async () => {
      const tools: AgentTool[] = [
        {
          name: 'ping',
          description: 'Ping the server',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ pong: true }),
        },
      ]

      const outputChunks: string[] = []
      const output = new Writable({
        write(chunk: any, _enc: any, cb: () => void) {
          outputChunks.push(chunk.toString())
          cb()
        },
      })

      const input = new EventEmitter() as any
      input.on = input.on.bind(input)

      const server = createMcpServer(tools, { input, output })

      // Send initialize
      input.emit('line', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
      await vi.waitFor(() => expect(outputChunks.length).toBeGreaterThanOrEqual(1))

      // Send tools/list
      input.emit('line', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }))
      await vi.waitFor(() => expect(outputChunks.length).toBeGreaterThanOrEqual(2))

      // Send tools/call
      input.emit('line', JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ping', arguments: {} } }))
      await vi.waitFor(() => expect(outputChunks.length).toBeGreaterThanOrEqual(3))

      const all = outputChunks.join('')
      expect(all).toContain('"ping"')
      expect(all).toContain('pong')
      expect(all).toContain('true')

      server.close()
    })

    it('rejects unknown tool', async () => {
      const tools: AgentTool[] = []
      const outputChunks: string[] = []
      const output = new Writable({
        write(chunk: any, _enc: any, cb: () => void) {
          outputChunks.push(chunk.toString())
          cb()
        },
      })
      const input = new EventEmitter() as any
      input.on = input.on.bind(input)

      const server = createMcpServer(tools, { input, output })

      input.emit('line', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
      await vi.waitFor(() => expect(outputChunks.length).toBeGreaterThanOrEqual(1))

      input.emit('line', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } }))
      await vi.waitFor(() => expect(outputChunks.length).toBeGreaterThanOrEqual(2))

      expect(outputChunks.join('')).toContain('Tool not found: nope')
      server.close()
    })
  })
})
