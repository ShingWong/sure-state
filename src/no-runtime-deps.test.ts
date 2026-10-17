import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The sure-* stack's client rule is "no framework, no runtime dependency".
 * This guard fails if a runtime/peer dependency (or an import of one) creeps
 * back in — the reason `createEntityStore` stopped using zustand's vanilla
 * bindings and carries its own store instead.
 */

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

function sourceFiles(): string[] {
  return readdirSync(here)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.endsWith('.test.ts'))
    .map((f) => join(here, f))
}

describe('runtime dependencies', () => {
  it('ships no runtime dependencies', () => {
    expect(pkg.dependencies ?? {}).toEqual({})
  })

  it('declares no state-management dependency in the source', () => {
    const offenders = sourceFiles().filter((file) => {
      const text = readFileSync(file, 'utf8')
      return /from\s+['"]zustand/.test(text) || /require\(['"]zustand/.test(text)
    })
    expect(offenders).toEqual([])
  })

  it('keeps only the optional React peer (for the react-devtools subpath)', () => {
    const peers = Object.keys(pkg.peerDependencies ?? {})
    expect(peers).toEqual(['react'])
    expect(pkg.peerDependenciesMeta?.react?.optional).toBe(true)
  })
})

describe('browser entry (@shing.wong/sure-state/core)', () => {
  const read = (file: string) => readFileSync(join(here, file), 'utf8')

  it('is exported from package.json', () => {
    const exportsMap = (pkg as unknown as { exports?: Record<string, unknown> }).exports ?? {}
    expect(Object.keys(exportsMap)).toContain('./core')
  })

  it('has no Node builtins in its module graph', () => {
    // core.ts -> create-entity-store.ts -> store.ts / types.ts
    const graph = ['core.ts', 'create-entity-store.ts', 'store.ts', 'types.ts']
    const nodeImports = /from\s+['"](node:|readline|crypto|fs|path|os|child_process|worker_threads)/ 
    const offenders = graph.filter((file) => nodeImports.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('re-exports only the store surface (no MCP/auth/cookie modules)', () => {
    const text = read('core.ts')
    expect(text).toContain('createEntityStore')
    for (const exclusion of ['createMcpServer', 'createSimpleAuth', 'createCookieStore', 'createWebSocketClient']) {
      expect(text).not.toContain(exclusion)
    }
  })
})
