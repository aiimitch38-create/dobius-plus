import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TERMINAL_KEYBOARD_METRICS_JS } from './terminal-webview-keyboard-metrics-injected'
import { TERMINAL_REFLOW_JS } from './terminal-webview-reflow-injected'

const htmlSource = readFileSync(new URL('./terminal-webview-html.ts', import.meta.url), 'utf8')

function extractBetween(startMarker: string, endMarker: string): string {
  const start = htmlSource.indexOf(startMarker)
  const end = htmlSource.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return htmlSource.slice(start, end)
}

function extractFunction(name: string, nextName: string): string {
  return extractBetween(`function ${name}(`, `function ${nextName}(`)
}

function createObserverHarness() {
  const posted: Array<Record<string, unknown>> = []
  const activeBuffer = { baseY: 0, cursorY: 4, type: 'normal', viewportY: 0 }
  let onWriteParsed = () => {}
  const term = {
    cols: 80,
    rows: 24,
    buffer: { active: activeBuffer },
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
    },
    scrollToBottom() {},
    scrollLines() {},
    onLineFeed: () => ({ dispose() {} }),
    onScroll: () => ({ dispose() {} }),
    onWriteParsed(callback: () => void) {
      onWriteParsed = callback
      return { dispose() {} }
    }
  }
  const observerSource = extractFunction('attachTermObservers', 'viewportToCell')
  const resizeSource = extractBetween('function resize(', '// reflow():')
  // eslint-disable-next-line no-new-func
  const functions = new Function(
    'term',
    'termObserverDisposables',
    'notify',
    'disposeTermObservers',
    'logFeedAndEvict',
    'emitModesIfChanged',
    'afterWritesDrained',
    'isAlternateBufferActive',
    'applyFitScale',
    'updateScrollIndicator',
    `
var initRows = 24;
var geometryProbe = { noteOutput: function() {}, noteRender: function() {} };
${TERMINAL_KEYBOARD_METRICS_JS}
${observerSource}
${resizeSource}
${TERMINAL_REFLOW_JS}
return { attachTermObservers, resetKeyboardAvoidanceMetrics, resize, reflow };
`
  )(
    term,
    [],
    (message: Record<string, unknown>) => posted.push(message),
    () => {},
    () => {},
    () => {},
    (callback: () => void) => callback(),
    () => activeBuffer.type === 'alternate',
    () => {},
    () => {}
  ) as {
    attachTermObservers: () => void
    resetKeyboardAvoidanceMetrics: () => void
    resize: (cols: number, rows: number) => void
    reflow: (cols: number, rows: number) => void
  }
  functions.attachTermObservers()
  return {
    activeBuffer,
    onWriteParsed: () => onWriteParsed(),
    posted,
    resetMetrics: functions.resetKeyboardAvoidanceMetrics,
    reflow: functions.reflow,
    resize: functions.resize,
    term
  }
}

describe('TerminalWebView keyboard metrics', () => {
  it('sends the initial state once and skips unchanged metrics during output bursts', () => {
    const harness = createObserverHarness()
    expect(
      harness.posted.filter((message) => message.type === 'keyboard-avoidance-metrics')
    ).toEqual([{ type: 'keyboard-avoidance-metrics', cursorY: 4, rows: 24, altScreen: false }])
    harness.posted.length = 0

    for (let index = 0; index < 100; index += 1) {
      harness.onWriteParsed()
    }

    expect(
      harness.posted.filter((message) => message.type === 'keyboard-avoidance-metrics')
    ).toHaveLength(0)
  })

  it('reports cursor, alternate-screen and resize changes, then emits fresh metrics after reset', () => {
    const harness = createObserverHarness()
    harness.posted.length = 0
    harness.activeBuffer.cursorY = 5
    harness.onWriteParsed()
    harness.onWriteParsed()
    harness.reflow(100, 32)
    harness.activeBuffer.type = 'alternate'
    harness.onWriteParsed()
    harness.resize(80, 30)

    expect(
      harness.posted.filter((message) => message.type === 'keyboard-avoidance-metrics')
    ).toEqual([
      { type: 'keyboard-avoidance-metrics', cursorY: 5, rows: 24, altScreen: false },
      { type: 'keyboard-avoidance-metrics', cursorY: 5, rows: 32, altScreen: false },
      { type: 'keyboard-avoidance-metrics', cursorY: 5, rows: 32, altScreen: true },
      { type: 'keyboard-avoidance-metrics', cursorY: 5, rows: 30, altScreen: true }
    ])

    harness.posted.length = 0
    harness.resetMetrics()
    harness.onWriteParsed()
    harness.onWriteParsed()
    expect(
      harness.posted.filter((message) => message.type === 'keyboard-avoidance-metrics')
    ).toEqual([{ type: 'keyboard-avoidance-metrics', cursorY: 5, rows: 30, altScreen: true }])

    const initStart = htmlSource.indexOf('function init(')
    const writeStart = htmlSource.indexOf('function write(', initStart)
    const initSource = htmlSource.slice(initStart, writeStart)
    expect(initSource).toContain('resetKeyboardAvoidanceMetrics();')
  })
})
