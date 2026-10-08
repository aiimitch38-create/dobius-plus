import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createTerminalWebViewMeasureTracker } from './terminal-webview-measure-tracker'

const htmlSource = readFileSync(new URL('./terminal-webview-html.ts', import.meta.url), 'utf8')
const componentSource = readFileSync(new URL('./TerminalWebView.tsx', import.meta.url), 'utf8')

function extractMeasureFunction(): string {
  const start = htmlSource.indexOf('function measureFitDimensions(')
  const end = htmlSource.indexOf('function handleMsg(', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return htmlSource.slice(start, end)
}

function createMeasureHarness(
  term: unknown,
  innerWidth: number,
  innerHeight: number,
  scheduledFrames: Array<() => void> = []
) {
  const posted: Array<Record<string, unknown>> = []
  const flog = vi.fn()
  // eslint-disable-next-line no-new-func
  const measure = new Function(
    'term',
    'MIN_FIT_COLS',
    'requestAnimationFrame',
    'window',
    'flog',
    'notify',
    `
${extractMeasureFunction()}
return measureFitDimensions;
`
  )(
    term,
    20,
    (callback: () => void) => scheduledFrames.push(callback),
    { innerWidth, innerHeight },
    flog,
    (message: Record<string, unknown>) => posted.push(message)
  ) as (containerHeight: number | undefined, requestId: number, retriesLeft?: number) => void
  return { flog, measure, posted, scheduledFrames }
}

describe('terminal WebView measurement correlation', () => {
  it('ignores stale and duplicate replies while resolving only the current request', () => {
    const tracker = createTerminalWebViewMeasureTracker()
    const settled: Array<{ request: string; result: { cols: number; rows: number } | null }> = []
    tracker.replace(41, (result) => settled.push({ request: 'old', result }))
    tracker.replace(42, (result) => settled.push({ request: 'current', result }))

    expect(settled).toEqual([{ request: 'old', result: null }])
    expect(tracker.resolve(41, { cols: 80, rows: 24 })).toBe(false)
    expect(tracker.cancel(41)).toBe(false)
    expect(settled).toEqual([{ request: 'old', result: null }])

    expect(tracker.resolve(42, { cols: 90, rows: 30 })).toBe(true)
    expect(tracker.resolve(42, { cols: 100, rows: 35 })).toBe(false)
    expect(settled).toEqual([
      { request: 'old', result: null },
      { request: 'current', result: { cols: 90, rows: 30 } }
    ])

    tracker.replace(43, (result) => settled.push({ request: 'timed-out', result }))
    expect(tracker.cancel(43)).toBe(true)
    tracker.replace(44, (result) => settled.push({ request: 'unmounted', result }))
    tracker.clear()
    expect(tracker.resolve(44, { cols: 100, rows: 35 })).toBe(false)
    expect(settled.slice(-2)).toEqual([
      { request: 'timed-out', result: null },
      { request: 'unmounted', result: null }
    ])
  })

  it('echoes the request ID for valid, rejected-width, and retry-exhausted results', () => {
    const readyTerm = {
      element: {},
      _core: { _renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } } } }
    }
    const valid = createMeasureHarness(readyTerm, 800, 600)
    valid.measure(400, 51)
    expect(valid.posted).toEqual([{ type: 'measure-result', id: 51, cols: 80, rows: 20 }])

    const tooNarrow = createMeasureHarness(readyTerm, 100, 600)
    tooNarrow.measure(400, 52)
    expect(tooNarrow.posted).toEqual([{ type: 'measure-result', id: 52, cols: null, rows: null }])

    const retry = createMeasureHarness(null, 800, 600)
    retry.measure(400, 53, 1)
    expect(retry.posted).toEqual([])
    expect(retry.scheduledFrames).toHaveLength(1)
    retry.scheduledFrames.shift()?.()
    expect(retry.posted).toEqual([{ type: 'measure-result', id: 53, cols: null, rows: null }])
  })

  it('sends the same command ID to the WebView and requires it on the RN reply path', () => {
    expect(componentSource).toContain("sendToWebView({ type: 'measure', containerHeight }, id)")
    expect(componentSource).toContain('measureTracker.resolve(')
    expect(componentSource).toContain('msg.id,')
    expect(componentSource).toContain('measureTracker.cancel(id)')

    const measureDispatch = htmlSource.slice(htmlSource.indexOf("msg.type === 'measure'"))
    expect(measureDispatch).toContain('measureFitDimensions(msg.containerHeight, msg.id)')
  })
})
