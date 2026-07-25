/**
 * Instrumentation adaptors that convert store events into metrics for
 * Prometheus, OpenTelemetry, or any monitoring backend.
 *
 * Usage:
 * ```ts
 * import { createEntityStore, createEventBus, prometheusMetrics } from 'sure-state'
 *
 * const bus = createEventBus()
 * const store = createEntityStore({ name: 'persona', ... })
 * const metrics = prometheusMetrics(bus, 'persona')
 *
 * // Later, expose metrics on your /metrics endpoint:
 * app.get('/metrics', (req, res) => {
 *   res.type('text/plain').send(metrics.dump())
 * })
 * ```
 */

import type { StoreEventBus } from './events'
import type { ActionRecord } from './inspector'

/**
 * Prometheus-style metrics collector.
 * Tracks counters, histograms, and gauges for store operations.
 */
export interface MetricsCollector {
  /** Increment a counter. */
  inc: (name: string, labels?: Record<string, string>, value?: number) => void
  /** Observe a value for histogram/p50/p99 calculation. */
  observe: (name: string, value: number, labels?: Record<string, string>) => void
  /** Set a gauge to a specific value. */
  gauge: (name: string, value: number, labels?: Record<string, string>) => void
  /** Dump all metrics in Prometheus text format. */
  dump: () => string
  /** Reset all metrics. */
  reset: () => void
}

export function createMetricsCollector(): MetricsCollector {
  const counters = new Map<string, number>()
  const histograms = new Map<string, number[]>()
  const gauges = new Map<string, number>()
  const labelSets = new Map<string, Record<string, string>>()

  function key(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return name
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',')
    return `${name}{${labelStr}}`
  }

  function inc(name: string, labels?: Record<string, string>, value = 1) {
    const k = key(name, labels)
    counters.set(k, (counters.get(k) ?? 0) + value)
    labelSets.set(k, labels ?? {})
  }

  function observe(name: string, value: number, labels?: Record<string, string>) {
    const k = key(name, labels)
    if (!histograms.has(k)) histograms.set(k, [])
    histograms.get(k)!.push(value)
    labelSets.set(k, labels ?? {})
  }

  function gauge(name: string, value: number, labels?: Record<string, string>) {
    const k = key(name, labels)
    gauges.set(k, value)
    labelSets.set(k, labels ?? {})
  }

  function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, idx)]!
  }

  function baseName(fullKey: string): string {
    const braceIdx = fullKey.indexOf('{')
    return braceIdx === -1 ? fullKey : fullKey.slice(0, braceIdx)
  }

  function labelString(labels: Record<string, string>): string {
    const entries = Object.entries(labels)
    if (entries.length === 0) return ''
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`
  }

  function metricLine(name: string, labels: Record<string, string>, value: string | number): string {
    return `${name}${labelString(labels)} ${value}`
  }

  function dump(): string {
    const lines: string[] = []

    // Counters
    for (const [k, val] of counters) {
      const labels = labelSets.get(k) ?? {}
      const name = baseName(k)
      lines.push(`# HELP ${name} Counter`)
      lines.push(`# TYPE ${name} counter`)
      lines.push(metricLine(name, labels, val))
    }

    // Histograms -> summary (p50, p90, p99, count)
    for (const [k, vals] of histograms) {
      if (vals.length === 0) continue
      const sorted = [...vals].sort((a, b) => a - b)
      const labels = labelSets.get(k) ?? {}
      const name = baseName(k) + '_duration_seconds'

      lines.push(`# HELP ${name} Operation duration`)
      lines.push(`# TYPE ${name} summary`)
      lines.push(metricLine(name + '_count', labels, vals.length))
      lines.push(metricLine(name + '_sum', labels, sorted.reduce((a, b) => a + b, 0)))
      lines.push(metricLine(name, { ...labels, quantile: '0.5' }, percentile(sorted, 50)))
      lines.push(metricLine(name, { ...labels, quantile: '0.9' }, percentile(sorted, 90)))
      lines.push(metricLine(name, { ...labels, quantile: '0.99' }, percentile(sorted, 99)))
    }

    // Gauges
    for (const [k, val] of gauges) {
      const labels = labelSets.get(k) ?? {}
      const name = baseName(k)
      lines.push(`# HELP ${name} Gauge`)
      lines.push(`# TYPE ${name} gauge`)
      lines.push(metricLine(name, labels, val))
    }

    return lines.join('\n') + '\n'
  }

  function reset() {
    counters.clear()
    histograms.clear()
    gauges.clear()
    labelSets.clear()
  }

  return { inc, observe, gauge, dump, reset }
}

/**
 * Wire a metrics collector to a store's event bus.
 * Returns `{ metrics, detach }`.
 *
 * @example
 * ```ts
 * const { metrics, detach } = attachMetrics(bus, 'persona')
 * // metrics.dump() returns Prometheus text
 * ```
 */
export function attachMetrics(bus: StoreEventBus, entityName: string) {
  const metrics = createMetricsCollector()

  const detachAction = bus.on('action', (action: ActionRecord) => {
    const labels = { entity: entityName, kind: action.kind }
    metrics.inc('sure_state_actions_total', labels)
    metrics.observe('sure_state_action_duration_ms', action.durationMs, labels)
    metrics.gauge('sure_state_items', action.detail?.includes('items') ? 0 : 0)
  })

  const detachError = bus.on('error', (err: { message: string; kind: string }) => {
    metrics.inc('sure_state_errors_total', { entity: entityName, kind: err.kind })
  })

  const detachSlow = bus.on('slow', (action: ActionRecord) => {
    metrics.inc('sure_state_slow_operations_total', { entity: entityName, kind: action.kind })
  })

  const detachSync = bus.on('sync', (sync: { status: string }) => {
    metrics.gauge('sure_state_websocket_connected', sync.status === 'connected' ? 1 : 0, { entity: entityName })
  })

  return {
    metrics,
    detach: () => {
      detachAction()
      detachError()
      detachSlow()
      detachSync()
    },
  }
}

/**
 * OpenTelemetry-compatible span exporter.
 * You pass a span creation function (e.g. from `@opentelemetry/api`).
 *
 * @example
 * ```ts
 * import { trace } from '@opentelemetry/api'
 * const tracer = trace.getTracer('sure-state')
 *
 * attachOtelSpans(bus, 'persona', (name, fn) => {
 *   return tracer.startActiveSpan(name, (span) => {
 *     try { return fn(span) }
 *     finally { span.end() }
 *   })
 * })
 * ```
 */
export function attachOtelSpans(
  bus: StoreEventBus,
  entityName: string,
  runWithSpan: <T>(name: string, fn: (span: any) => T) => T,
) {
  return bus.on('action', (action: ActionRecord) => {
    if (action.kind === 'push') return // too noisy for spans
    runWithSpan(`${entityName}.${action.kind}`, (span) => {
      span?.setAttributes?.({
        'sure-state.entity': entityName,
        'sure-state.kind': action.kind,
        'sure-state.duration_ms': action.durationMs,
        'sure-state.success': action.success,
      })
      if (action.detail) span?.setAttribute?.('sure-state.detail', action.detail)
    })
  })
}
