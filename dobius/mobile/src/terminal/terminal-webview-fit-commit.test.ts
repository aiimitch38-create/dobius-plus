import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const htmlSource = readFileSync(new URL('./terminal-webview-html.ts', import.meta.url), 'utf8')
const swapSource = readFileSync(
  new URL('./terminal-webview-surface-swap-injected.ts', import.meta.url),
  'utf8'
)
const fitCommitSource = readFileSync(
  new URL('./terminal-webview-fit-commit-injected.ts', import.meta.url),
  'utf8'
)

function extractBetween(startMarker: string, endMarker: string): string {
  const start = htmlSource.indexOf(startMarker)
  const end = htmlSource.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return htmlSource.slice(start, end)
}

function extractInjectedFunction(source: string, marker: string): string {
  const start = source.indexOf(marker)
  const end = source.indexOf('\n`', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('terminal WebView fit commit', () => {
  it('wires replacement-surface visibility to the fit commit during reinitialization', () => {
    const initSource = extractBetween('function init(', 'function write(')
    const fitCommitSource = extractBetween(
      'function commitFitScale(',
      'function isAltScreenActive('
    )
    const finishCommit = extractInjectedFunction(
      readFileSync(new URL('./terminal-webview-fit-commit-injected.ts', import.meta.url), 'utf8'),
      'function finishFitCommit()'
    )
    const fitRequest = initSource.indexOf("applyFitScale('init-replay', function()")
    const swapCall = initSource.indexOf(
      'commitInitSurfaceSwap(gen, nextSurface, oldSurface, oldTerm, cols, rows)'
    )
    const preparedSwap = initSource.indexOf('prepareInitSurface()')
    const stopProbe = initSource.indexOf('geometryProbe.stop()')
    const hiddenSurface = initSource.indexOf("nextSurface.style.visibility = 'hidden'")

    expect(stopProbe).toBeGreaterThanOrEqual(0)
    expect(stopProbe).toBeLessThan(hiddenSurface)
    expect(fitRequest).toBeGreaterThanOrEqual(0)
    expect(swapCall).toBeGreaterThan(fitRequest)
    expect(preparedSwap).toBeGreaterThanOrEqual(0)
    expect(preparedSwap).toBeLessThan(initSource.indexOf('new Terminal('))
    expect(initSource).toContain('prepareRetainedSurface(oldSurface)')
    expect(fitCommitSource).toContain("geometryProbe.start(finishFitCommit() ? 'init' : 'fit')")
    expect(finishCommit.indexOf('if (callback) callback();')).toBeLessThan(
      finishCommit.indexOf('return !!callback;')
    )
    expect(initSource.indexOf('term.scrollToLine')).toBeLessThan(fitRequest)
    expect(swapSource.indexOf("oldSurface.classList.add('terminal-surface')")).toBeLessThan(
      swapSource.indexOf("oldSurface.removeAttribute('id')")
    )
    expect(swapSource).toContain("oldSurface.style.pointerEvents = 'none'")
    expect(swapSource).toContain(
      'if (!pendingSurfaceSwap || pendingSurfaceSwap.gen !== gen) return'
    )
    const reveal = swapSource.indexOf("visibility: 'visible'")
    expect(reveal).toBeGreaterThanOrEqual(0)
    expect(swapSource.indexOf('oldSurface.remove()', reveal)).toBeGreaterThan(reveal)
    expect(initSource).toContain(
      "applyFitScale('init-replay');\n          notify({ type: 'ready', cols: cols, rows: rows });"
    )
  })

  it('keeps the prior surface styled but noninteractive during replacement', () => {
    const events: string[] = []
    const oldSurface = {
      classList: { add: (name: string) => events.push(`class:${name}`) },
      style: {} as Record<string, string>,
      removeAttribute: (name: string) => events.push(`remove-attribute:${name}`)
    }
    const prepareRetainedSurface = new Function(
      `${extractInjectedFunction(swapSource, 'function prepareRetainedSurface(')}\nreturn prepareRetainedSurface;`
    )() as (surface: typeof oldSurface) => void

    prepareRetainedSurface(oldSurface)
    expect(oldSurface.style.pointerEvents).toBe('none')
    expect(events).toEqual(['class:terminal-surface', 'remove-attribute:id'])
  })

  it('keeps a pending reveal behind the latest fit commit, including a superseding refit', () => {
    const fitSource = extractBetween('var FIT_RETRY_MAX_FRAMES', 'function isAltScreenActive(')
    const events: string[] = []
    const frames: Array<() => void> = []
    const term = { cols: 100, element: { scrollWidth: 800 } }
    let cellWidth = 0
    let visible = false

    // eslint-disable-next-line no-new-func
    const applyFitScale = new Function(
      'term',
      'getCellWidth',
      'computeFitScale',
      'updateTransform',
      'adjustRowsForViewport',
      'flog',
      'window',
      'requestAnimationFrame',
      'repositionOverlay',
      'geometryProbe',
      `
var smoothScrollOffsetY = 0;
var currentScale = 1;
var userScale = 1;
var panX = 0;
var panY = 0;
${fitSource}
${extractInjectedFunction(fitCommitSource, 'function finishFitCommit()')}
return applyFitScale;
`
    )(
      term,
      () => cellWidth,
      () => 0.5,
      () => events.push('transform'),
      () => {},
      () => {},
      { innerWidth: 400 },
      (callback: () => void) => frames.push(callback),
      () => events.push('overlay'),
      { start: (reason: string) => events.push(`probe:${reason}`) }
    ) as (reason: string, onCommitted?: () => void) => void

    applyFitScale('init-replay', () => {
      visible = true
      events.push('reveal')
    })
    expect(visible).toBe(false)

    // The first fit is superseded before its frame runs. The reveal callback
    // must follow the current transform commit, not be dropped with the token.
    applyFitScale('first-data')
    frames.shift()?.()
    expect(visible).toBe(false)
    frames.shift()?.()
    expect(events).toEqual([])

    cellWidth = 8
    frames.shift()?.()
    expect(visible).toBe(true)
    expect(events).toEqual(['transform', 'overlay', 'reveal', 'probe:init'])
    expect(events.indexOf('reveal')).toBeLessThan(events.indexOf('probe:init'))
  })

  it('releases the replacement on the bounded fit-timeout commit', () => {
    const events: string[] = []
    const frames: Array<() => void> = []
    let width = 0
    const term = {
      cols: 100,
      element: {
        get scrollWidth() {
          return ++width
        }
      }
    }
    // eslint-disable-next-line no-new-func
    const applyFitScale = new Function(
      'term',
      'getCellWidth',
      'computeFitScale',
      'updateTransform',
      'adjustRowsForViewport',
      'flog',
      'window',
      'requestAnimationFrame',
      'repositionOverlay',
      'geometryProbe',
      `
var smoothScrollOffsetY = 0;
var currentScale = 1;
var userScale = 1;
var panX = 0;
var panY = 0;
${extractBetween('var FIT_RETRY_MAX_FRAMES', 'function isAltScreenActive(')}
${extractInjectedFunction(fitCommitSource, 'function finishFitCommit()')}
return applyFitScale;
`
    )(
      term,
      () => 0,
      () => 0.5,
      () => events.push('transform'),
      () => {},
      () => events.push('timeout'),
      { innerWidth: 400 },
      (callback: () => void) => frames.push(callback),
      () => events.push('overlay'),
      { start: (reason: string) => events.push(`probe:${reason}`) }
    ) as (reason: string, onCommitted?: () => void) => void

    applyFitScale('init-replay', () => events.push('ready'))
    let attempts = 0
    while (frames.length > 0 && attempts < 60) {
      frames.shift()?.()
      attempts++
    }

    expect(attempts).toBe(60)
    expect(events).toEqual(['timeout', 'transform', 'overlay', 'ready', 'probe:init'])
    expect(events.indexOf('ready')).toBeLessThan(events.indexOf('probe:init'))
  })

  it('reveals only the matching pending surface generation', () => {
    const events: string[] = []
    const nextSurface = { style: {} as Record<string, string> }
    const oldSurface = { remove: () => events.push('remove-old') }
    const oldTerm = { dispose: () => events.push('dispose-old') }
    const commitInitSurfaceSwap = new Function(
      'notify',
      'pendingSurfaceSwap',
      `${extractInjectedFunction(swapSource, 'function commitInitSurfaceSwap(')}\nreturn commitInitSurfaceSwap;`
    )((message: { type: string }) => events.push(message.type), { gen: 4 }) as (
      gen: number,
      next: typeof nextSurface,
      old: typeof oldSurface,
      term: typeof oldTerm,
      cols: number,
      rows: number
    ) => void

    commitInitSurfaceSwap(3, nextSurface, oldSurface, oldTerm, 91, 38)
    expect(events).toEqual([])

    commitInitSurfaceSwap(4, nextSurface, oldSurface, oldTerm, 91, 38)
    expect(nextSurface.style).toEqual({ visibility: 'visible', position: '', left: '', top: '' })
    expect(events).toEqual(['remove-old', 'dispose-old', 'ready'])
  })

  it('abandons a hidden pending surface and keeps its last visible predecessor', () => {
    const events: string[] = []
    const stableSurface = { remove: () => events.push('remove-stable') }
    const pendingSurface = { remove: () => events.push('remove-pending') }
    const stableTerm = { dispose: () => events.push('dispose-stable') }
    const pendingTerm = { dispose: () => events.push('dispose-pending') }
    const prepareInitSurface = new Function(
      'pendingSurfaceSwap',
      'surface',
      'term',
      'disposeTermObservers',
      `${extractInjectedFunction(swapSource, 'function abandonPendingSurfaceSwap()')}\nreturn prepareInitSurface;`
    )({ gen: 2, oldSurface: stableSurface, oldTerm: stableTerm }, pendingSurface, pendingTerm, () =>
      events.push('dispose-observers')
    ) as () => { oldSurface: typeof stableSurface; oldTerm: typeof stableTerm } | null

    const retained = prepareInitSurface()
    expect(retained).toEqual({ gen: 2, oldSurface: stableSurface, oldTerm: stableTerm })
    expect(events).toEqual(['dispose-observers', 'remove-pending', 'dispose-pending'])
  })
})
