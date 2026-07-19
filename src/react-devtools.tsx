'use client'

/**
 * React component that renders an inspectable debug panel for a sure-state store.
 *
 * Usage:
 * ```tsx
 * import { InspectorPanel } from 'sure-state/react-devtools'
 * import { personaStore } from './stores'
 * import { createInspector } from 'sure-state'
 *
 * const personaInspector = createInspector(personaStore)
 *
 * function App() {
 *   return (
 *     <>
 *       <YourUI />
 *       <InspectorPanel inspector={personaInspector} title="Personas" />
 *     </>
 *   )
 * }
 * ```
 */
import { useEffect, useSyncExternalStore, useState, useCallback } from 'react'
import type { Inspector } from './inspector'

interface InspectorPanelProps {
  inspector: Inspector
  title?: string
  defaultOpen?: boolean
}

const panelStyle: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    bottom: 0,
    right: 0,
    zIndex: 99999,
    width: '480px',
    maxHeight: '60vh',
    background: '#1e1e2e',
    color: '#cdd6f4',
    fontFamily: 'monospace',
    fontSize: '12px',
    borderTopLeftRadius: '8px',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: '#181825',
    borderBottom: '1px solid #313244',
    cursor: 'pointer',
    userSelect: 'none',
  },
  badge: {
    background: '#45475a',
    color: '#cdd6f4',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '10px',
    marginLeft: '8px',
  },
  body: {
    padding: '8px 12px',
    overflowY: 'auto',
    flex: 1,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
    borderBottom: '1px solid #313244',
  },
  label: {
    color: '#a6adc8',
  },
  value: {
    color: '#a6e3a1',
  },
  actionRow: {
    padding: '6px 8px',
    margin: '4px 0',
    borderRadius: '4px',
    fontSize: '11px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  success: {
    background: '#1e3a2f',
    color: '#a6e3a1',
  },
  error: {
    background: '#3a1e1e',
    color: '#f38ba8',
  },
  button: {
    background: '#45475a',
    color: '#cdd6f4',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '11px',
  },
}

function ActionRow({ action }: { action: any }) {
  const bg = action.success ? actionSuccessStyle : actionErrorStyle
  return (
    <div style={{ ...panelStyle.actionRow, ...bg }}>
      <span>
        <strong>{action.kind.toUpperCase()}</strong>
        {action.detail ? ` ${action.detail.slice(0, 60)}` : ''}
      </span>
      <span style={{ color: '#6c7086' }}>
        {action.durationMs}ms
      </span>
    </div>
  )
}

const actionSuccessStyle = { background: '#1e3a2f' }
const actionErrorStyle = { background: '#3a1e1e' }

export function InspectorPanel({ inspector, title = 'Store', defaultOpen = false }: InspectorPanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [actions, setActions] = useState<readonly any[]>(inspector.getActions())

  useEffect(() => {
    const unsub = inspector.onAction(() => {
      setActions([...inspector.getActions()])
    })
    return unsub
  }, [inspector])

  const dump = inspector.dump()

  return (
    <div style={panelStyle.container}>
      <div style={panelStyle.header} onClick={() => setOpen(!open)}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>{title}</span>
          <span style={panelStyle.badge}>
            {dump.itemsCount} items
          </span>
          <span style={{ ...panelStyle.badge, background: dump.isLoading ? '#f9e2af' : '#45475a', color: dump.isLoading ? '#1e1e2e' : '#cdd6f4' }}>
            {dump.isLoading ? 'busy' : 'idle'}
          </span>
          {dump.error && (
            <span style={{ ...panelStyle.badge, background: '#f38ba8', color: '#1e1e2e' }}>
              error
            </span>
          )}
        </div>
        <span style={{ color: '#6c7086' }}>{open ? '▼' : '▲'}</span>
      </div>

      {open && (
        <div style={panelStyle.body}>
          {/* Summary */}
          <div style={{ marginBottom: 12 }}>
            <div style={panelStyle.row}>
              <span style={panelStyle.label}>Sync</span>
              <span style={panelStyle.value}>{dump.sync}</span>
            </div>
            <div style={panelStyle.row}>
              <span style={panelStyle.label}>Versioning</span>
              <span style={panelStyle.value}>{dump.versioning ? 'on' : 'off'}</span>
            </div>
            <div style={panelStyle.row}>
              <span style={panelStyle.label}>Items</span>
              <span style={panelStyle.value}>{dump.itemsCount}</span>
            </div>
            <div style={panelStyle.row}>
              <span style={panelStyle.label}>Selected</span>
              <span style={panelStyle.value}>{dump.selectedId ?? 'none'}</span>
            </div>
            <div style={panelStyle.row}>
              <span style={panelStyle.label}>Actions logged</span>
              <span style={panelStyle.value}>{dump.actionCount}</span>
            </div>
            {dump.error && (
              <div style={{ ...panelStyle.row, color: '#f38ba8' }}>
                <span style={panelStyle.label}>Error</span>
                <span>{dump.error}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: '13px' }}>Recent actions</span>
            <button
              style={panelStyle.button}
              onClick={() => { inspector.clear(); setActions([]) }}
            >
              Clear
            </button>
          </div>

          {actions.length === 0 && (
            <div style={{ color: '#6c7086', textAlign: 'center', padding: 16 }}>
              No actions recorded yet
            </div>
          )}

          {actions.slice(-30).reverse().map((a) => (
            <ActionRow key={a.id} action={a} />
          ))}
        </div>
      )}
    </div>
  )
}
