export type TerminalWebViewLifecycleEvent =
  | 'active-state'
  | 'load-start'
  | 'web-ready'
  | 'reload-requested'
  | 'load-error'
  | 'http-error'
  | 'render-process-gone'
  | 'content-process-ended'

export function createTerminalWebViewDiagnosticKey(terminalHandle: string): string {
  // Why: correlate terminal lifecycle events without logging a raw
  // handle that may contain a host-specific identifier.
  let hash = 2166136261
  for (let index = 0; index < terminalHandle.length; index += 1) {
    hash = Math.imul(hash ^ terminalHandle.charCodeAt(index), 16777619)
  }
  return `terminal-${(hash >>> 0).toString(36)}`
}

export type TerminalWebViewLifecycleRecord = {
  readonly terminalKey: string
  readonly event: TerminalWebViewLifecycleEvent
  readonly generation: number
  readonly active: boolean
  readonly atMs: number
  readonly sincePreviousEventMs?: number
}

export type TerminalWebViewDiagnosticOptions = {
  readonly terminalKey: string
  readonly active: boolean
  readonly enabled: boolean
}

export const TERMINAL_WEBVIEW_DIAGNOSTICS_DISABLED: TerminalWebViewDiagnosticOptions = {
  terminalKey: 'unknown',
  active: false,
  enabled: false
}

export function createTerminalWebViewLifecycleRecord(
  record: TerminalWebViewLifecycleRecord
): TerminalWebViewLifecycleRecord {
  return record
}

export type TerminalWebViewDiagnosticSnapshot = TerminalWebViewDiagnosticOptions & {
  readonly generation: number
}

export type TerminalWebViewGeometryProbeReason = 'active' | 'init' | 'fit'

export type TerminalWebViewGeometryNumbers = Readonly<Record<string, number>>

export type TerminalWebViewGeometryProbeSample = {
  readonly type: 'geometry-probe'
  readonly reason: TerminalWebViewGeometryProbeReason
  readonly frame: number
  readonly sampledAtMs: number
  readonly elapsedMs: number
  readonly geometry: TerminalWebViewGeometryNumbers
}

export type TerminalWebViewGeometryRecord = TerminalWebViewDiagnosticSnapshot & {
  readonly event: 'geometry-probe'
  readonly reason: TerminalWebViewGeometryProbeReason
  readonly frame: number
  readonly sampledAtMs: number
  readonly elapsedMs: number
  readonly receivedAtMs: number
  readonly geometry: TerminalWebViewGeometryNumbers
}

export const TERMINAL_WEBVIEW_GEOMETRY_PROBE_LIMITS = {
  maxFrames: 3600,
  maxRecordsPerWindow: 24,
  maxWindowMs: 30000,
  maxWindowsPerGeneration: 3
} as const

const TERMINAL_WEBVIEW_GEOMETRY_KEYS = new Set([
  ...['root', 'container', 'surface', 'xterm', 'xtermCanvas'].flatMap((prefix) =>
    [
      'present',
      'x',
      'y',
      'left',
      'top',
      'right',
      'bottom',
      'width',
      'height',
      'clientWidth',
      'clientHeight'
    ].map((field) => `${prefix}.${field}`)
  ),
  'transform.a',
  'transform.b',
  'transform.c',
  'transform.d',
  'transform.tx',
  'transform.ty',
  'transformOrigin.x',
  'transformOrigin.y',
  'transformOrigin.z',
  'panX',
  'panY',
  'fitScale',
  'userScale',
  'totalScale',
  'cols',
  'rows',
  'cellWidth',
  'cellHeight',
  'windowWidth',
  'windowHeight',
  'pageXOffset',
  'pageYOffset',
  'visualViewportPresent',
  'visualViewportWidth',
  'visualViewportHeight',
  'visualViewportOffsetLeft',
  'visualViewportOffsetTop',
  'visualViewportPageLeft',
  'visualViewportPageTop',
  'visualViewportScale',
  'outputCount',
  'outputLastAtMs',
  'outputIntervalMs',
  'renderCount',
  'renderLastAtMs',
  'renderIntervalMs',
  'fitPassCount',
  'fitLastAtMs',
  'fitIntervalMs'
])

function isGeometryNumbers(value: unknown): value is TerminalWebViewGeometryNumbers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const entries = Object.entries(value)
  return (
    entries.length > 0 &&
    entries.length <= TERMINAL_WEBVIEW_GEOMETRY_KEYS.size &&
    entries.every(
      ([key, entry]) =>
        TERMINAL_WEBVIEW_GEOMETRY_KEYS.has(key) &&
        typeof entry === 'number' &&
        Number.isFinite(entry)
    )
  )
}

export function createTerminalWebViewGeometryRecord(
  snapshot: TerminalWebViewDiagnosticSnapshot,
  sample: unknown,
  receivedAtMs: number
): TerminalWebViewGeometryRecord | null {
  if (!snapshot.enabled || !snapshot.active || !sample || typeof sample !== 'object') {
    return null
  }
  const candidate = sample as Partial<TerminalWebViewGeometryProbeSample>
  if (
    candidate.type !== 'geometry-probe' ||
    (candidate.reason !== 'active' && candidate.reason !== 'init' && candidate.reason !== 'fit') ||
    !Number.isInteger(candidate.frame) ||
    candidate.frame! < 1 ||
    candidate.frame! > TERMINAL_WEBVIEW_GEOMETRY_PROBE_LIMITS.maxFrames ||
    !Number.isFinite(candidate.sampledAtMs) ||
    !Number.isFinite(candidate.elapsedMs) ||
    candidate.elapsedMs! < 0 ||
    candidate.elapsedMs! > TERMINAL_WEBVIEW_GEOMETRY_PROBE_LIMITS.maxWindowMs ||
    !isGeometryNumbers(candidate.geometry) ||
    !Number.isFinite(receivedAtMs)
  ) {
    return null
  }
  return {
    ...snapshot,
    event: 'geometry-probe',
    reason: candidate.reason,
    frame: candidate.frame!,
    sampledAtMs: candidate.sampledAtMs!,
    elapsedMs: candidate.elapsedMs!,
    receivedAtMs,
    geometry: candidate.geometry
  }
}

export function reportTerminalWebViewGeometry(
  snapshot: TerminalWebViewDiagnosticSnapshot,
  sample: unknown,
  log: (record: TerminalWebViewGeometryRecord) => void = (record) => {
    console.log('[terminal-webview-geometry]', record)
  },
  now: () => number = Date.now
): void {
  const record = createTerminalWebViewGeometryRecord(snapshot, sample, now())
  if (record) {
    log(record)
  }
}

export function handleTerminalWebViewGeometryMessage(
  snapshot: TerminalWebViewDiagnosticSnapshot,
  message: unknown
): boolean {
  if (
    !message ||
    typeof message !== 'object' ||
    (message as { type?: unknown }).type !== 'geometry-probe'
  ) {
    return false
  }
  reportTerminalWebViewGeometry(snapshot, message)
  return true
}

export function reportTerminalWebViewActiveState(
  active: boolean,
  enabled: boolean,
  reportLifecycleEvent: (event: TerminalWebViewLifecycleEvent) => void,
  postProbeCommand: (command: { type: 'geometry-probe'; active: boolean }) => void
): void {
  reportLifecycleEvent('active-state')
  if (enabled) {
    postProbeCommand({ type: 'geometry-probe', active })
  }
}

export function createTerminalWebViewLifecycleReporter(
  getSnapshot: () => TerminalWebViewDiagnosticSnapshot,
  log: (record: TerminalWebViewLifecycleRecord) => void = (record) => {
    console.log('[terminal-webview-lifecycle]', record)
  },
  now: () => number = Date.now
): (event: TerminalWebViewLifecycleEvent) => void {
  let previousEventAtMs = now()
  return (event) => {
    const snapshot = getSnapshot()
    if (!snapshot.enabled) {
      return
    }
    const atMs = now()
    log(
      createTerminalWebViewLifecycleRecord({
        terminalKey: snapshot.terminalKey,
        event,
        generation: snapshot.generation,
        active: snapshot.active,
        atMs,
        sincePreviousEventMs: atMs - previousEventAtMs
      })
    )
    previousEventAtMs = atMs
  }
}

export function createTerminalWebViewNativeErrorHandlers<T>(
  reportLifecycleEvent: (event: TerminalWebViewLifecycleEvent) => void,
  reportNativeEngineError: (message: string, event: T) => void
) {
  return {
    onLoadError: (event: T) => {
      reportLifecycleEvent('load-error')
      reportNativeEngineError('Terminal WebView load failed', event)
    },
    onHttpError: (event: T) => {
      reportLifecycleEvent('http-error')
      reportNativeEngineError('Terminal WebView HTTP error', event)
    },
    onRenderProcessGone: (event: T) => {
      reportLifecycleEvent('render-process-gone')
      reportNativeEngineError('Terminal WebView render process ended', event)
    },
    onContentProcessDidTerminate: (event: T) => {
      reportLifecycleEvent('content-process-ended')
      reportNativeEngineError('Terminal WebView content process ended', event)
    }
  }
}
