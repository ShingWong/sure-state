/**
 * Lightweight MCP (Model Context Protocol) server over stdio.
 *
 * No external SDK dependency — implements the MCP wire protocol
 * (JSON-RPC 2.0 over stdin/stdout with newline-delimited messages).
 *
 * Start it:
 * ```ts
 * import { createMcpServer } from 'sure-state'
 * createMcpServer(tools)
 * ```
 *
 * Then connect an agent (OpenCode, Claude Desktop) via:
 * ```
 * node your-script.js
 * ```
 */

import type { AgentTool } from './agent-tools'
import type { Writable } from 'stream'
import type { Interface } from 'readline'

interface McpRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

interface McpResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type InputLineEmitter = { on: (event: 'line', cb: (line: string) => void) => void }

export interface McpServerOptions {
  /** Input emitter (default: readline on process.stdin) */
  input?: InputLineEmitter
  /** Output writable (default: process.stdout) */
  output?: Writable
}

export function createMcpServer(tools: AgentTool[], options?: McpServerOptions): { close: () => void } {
  let initialized = false
  let rl: Interface | null = null

  const output = options?.output ?? process.stdout

  function respond(response: McpResponse): void {
    output.write(JSON.stringify(response) + '\n')
  }

  function handleRequest(line: string): void {
    let request: McpRequest
    try {
      request = JSON.parse(line)
    } catch {
      return
    }

    const { id, method, params } = request

    switch (method) {
      case 'initialize': {
        initialized = true
        respond({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '0.1.0',
            capabilities: { tools: {} },
            serverInfo: { name: 'sure-state-inspect', version: '0.1.0' },
          },
        })
        break
      }

      case 'notifications/initialized':
        break

      case 'tools/list': {
        if (!initialized) {
          respond({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Not initialized' } })
          break
        }
        respond({
          jsonrpc: '2.0',
          id,
          result: {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        })
        break
      }

      case 'tools/call': {
        if (!initialized) {
          respond({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Not initialized' } })
          break
        }
        const { name, arguments: args } = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
        const tool = tools.find((t) => t.name === name)
        if (!tool) {
          respond({ jsonrpc: '2.0', id, error: { code: -32601, message: `Tool not found: ${name}` } })
          break
        }
        tool.handler(args ?? {})
          .then((result) => {
            respond({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  { type: 'text', text: JSON.stringify(result, null, 2) },
                ],
              },
            })
          })
          .catch((err: Error) => {
            respond({
              jsonrpc: '2.0',
              id,
              error: { code: -32603, message: err.message },
            })
          })
        break
      }

      default:
        respond({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
    }
  }

  if (options?.input) {
    options.input.on('line', handleRequest)
  } else {
    import('readline').then(({ createInterface }) => {
      rl = createInterface({ input: process.stdin })
      rl.on('line', handleRequest)
    })
  }

  return {
    close: () => {
      if (rl) rl.close()
    },
  }
}
