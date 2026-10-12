import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, it } from 'vitest'

function range(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert(start >= 0 && end > start, `missing source range ${startMarker} -> ${endMarker}`)
  return source.slice(start, end)
}

function functionSource(source: string, marker: string): string {
  const start = source.indexOf(marker)
  assert(start >= 0, `missing function ${marker}`)
  const open = source.indexOf('{', start)
  assert(open > start, `missing opening brace for ${marker}`)
  let depth = 0
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (lineComment) {
      if (ch === '\n') {
        lineComment = false
      }
      continue
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false
        i++
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === quote) {
        quote = ''
      }
      continue
    }
    if (ch === '/' && next === '/') {
      lineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      blockComment = true
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') {
      depth++
    }
    if (ch === '}' && --depth === 0) {
      return source.slice(start, i + 1)
    }
  }
  throw new Error(`unterminated function ${marker}`)
}

function templateBody(source: string, marker: string): string {
  const start = source.indexOf(marker)
  assert(start >= 0, `missing template marker ${marker}`)
  const bodyStart = source.indexOf('`', start) + 1
  const end = source.lastIndexOf('\n`')
  assert(bodyStart > 0 && end >= bodyStart, `missing template end ${marker}`)
  return source.slice(bodyStart, end)
}

describe('terminal WebView init/probe integration', () => {
  it('keeps active geometry sampling off hidden A→B→C replacement surfaces', () => {
    const html = readFileSync(new URL('./terminal-webview-html.ts', import.meta.url), 'utf8')
    const fitCommit = readFileSync(
      new URL('./terminal-webview-fit-commit-injected.ts', import.meta.url),
      'utf8'
    )
    const surfaceSwap = readFileSync(
      new URL('./terminal-webview-surface-swap-injected.ts', import.meta.url),
      'utf8'
    )
    const probeTs = readFileSync(
      new URL('./terminal-webview-geometry-probe.ts', import.meta.url),
      'utf8'
    )
    const initSource = range(html, 'function init(', 'function write(')
    const fitSource = range(html, 'var FIT_RETRY_MAX_FRAMES', 'function isAltScreenActive(')
    const finishFitSource = functionSource(fitCommit, 'function finishFitCommit(')
    const runtimeHelpers = [
      'function resetWriteQueue(',
      'function enqueueWrite(',
      'function nextQueuedWrite(',
      'function disposeTermObservers(',
      'function pumpWrites(',
      'function afterWritesDrained(',
      'function resetEvictionCounter(',
      'function attachTermObservers(',
      'function cancelSelect('
    ]
      .map((marker) => functionSource(html, marker))
      .join('\n')
    const swapFunctions = [
      'function prepareRetainedSurface(',
      'function abandonPendingSurfaceSwap(',
      'function prepareInitSurface(',
      'function commitInitSurfaceSwap('
    ]
      .map((marker) => functionSource(surfaceSwap, marker))
      .join('\n')
    const probeScript = templateBody(probeTs, 'String.raw`')
    assert.match(probeScript, /MAX_FRAMES = 3600/)
    assert.match(probeScript, /MAX_RECORDS = 24/)
    assert.match(probeScript, /MAX_WINDOW_MS = 30000/)
    assert.match(probeScript, /MAX_WINDOWS_PER_GENERATION = 3/)

    let nextRaf = 1
    let nextTimer = 1
    const rafs = new Map()
    const timers = new Map()
    const messages = []
    const surfaces = []
    let terminalSerial = 0

    function rectElement(rectFn, width, height, querySelector = () => null) {
      return {
        clientWidth: width,
        clientHeight: height,
        get scrollWidth() {
          return width
        },
        getBoundingClientRect: rectFn,
        querySelector
      }
    }

    function makeSurface(name, visibility = 'visible') {
      const item = {
        name,
        id: 'terminal-surface',
        removed: false,
        style: {
          visibility,
          position: visibility === 'hidden' ? 'absolute' : 'relative',
          left: '0px',
          top: '0px',
          transform: 'matrix(1, 0, 0, 1, 0, 0)',
          transformOrigin: '0px 0px 0px',
          pointerEvents: 'auto'
        },
        classes: new Set(),
        classList: {
          add(value) {
            item.classes.add(value)
          }
        },
        removeAttribute(name) {
          if (name === 'id') {
            item.id = ''
          }
        },
        remove() {
          item.removed = true
          item.id = ''
        },
        getBoundingClientRect() {
          const matrix = String(item.style.transform).match(/matrix\(([^)]+)\)/)
          const parts = matrix ? matrix[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0]
          const a = parts[0] || 1
          const tx = parts[4] || 0
          const ty = parts[5] || 0
          const left = Number.parseFloat(item.style.left) || 0
          const top = Number.parseFloat(item.style.top) || 0
          const width = 480 * a
          const height = 477 * a
          return {
            x: left + tx,
            y: top + ty,
            left: left + tx,
            top: top + ty,
            right: left + tx + width,
            bottom: top + ty + height,
            width,
            height
          }
        }
      }
      surfaces.push(item)
      return item
    }

    const A = makeSurface('A')
    A.style.transform = 'matrix(0.838, 0, 0, 0.838, 0, 0)'
    const container = {
      children: [],
      clientWidth: 402,
      clientHeight: 616,
      appendChild(child) {
        this.children.push(child)
      },
      getBoundingClientRect() {
        return { x: 0, y: 0, left: 0, top: 0, right: 402, bottom: 616, width: 402, height: 616 }
      }
    }
    const rootElement = {
      clientWidth: 402,
      clientHeight: 616,
      getBoundingClientRect() {
        return { x: 0, y: 0, left: 0, top: 0, right: 402, bottom: 616, width: 402, height: 616 }
      }
    }
    const document = {
      documentElement: rootElement,
      createElement(tag) {
        assert.equal(tag, 'div')
        return makeSurface(`surface-${surfaces.length}`, 'hidden')
      },
      getElementById(id) {
        if (id === 'terminal-container') {
          return container
        }
        if (id === 'terminal-surface') {
          return (
            surfaces.toReversed().find((surface) => surface.id === id && !surface.removed) ?? null
          )
        }
        return null
      }
    }

    function makeTerminal(name, options = {}) {
      const terminal = {
        name,
        cols: options.cols ?? 120,
        rows: options.rows ?? 53,
        disposed: false,
        element: null,
        buffer: { active: { baseY: 0, viewportY: 0 } },
        unicode: { activeVersion: '' },
        open(surface) {
          surface.terminal = terminal
          const canvas = rectElement(() => surface.getBoundingClientRect(), 480, 477)
          terminal.element = rectElement(
            () => surface.getBoundingClientRect(),
            480,
            477,
            () => canvas
          )
        },
        dispose() {
          terminal.disposed = true
        },
        loadAddon() {},
        onLineFeed() {
          return { dispose() {} }
        },
        onScroll() {
          return { dispose() {} }
        },
        onWriteParsed() {
          return { dispose() {} }
        },
        onRender() {
          return { dispose() {} }
        },
        write(_data, callback) {
          callback?.()
        },
        clearSelection() {},
        refresh() {},
        scrollToLine() {}
      }
      return terminal
    }

    const windowObject = {
      innerWidth: 402,
      innerHeight: 616,
      pageXOffset: 0,
      pageYOffset: 0,
      visualViewport: {
        width: 402,
        height: 616,
        offsetLeft: 0,
        offsetTop: 0,
        pageLeft: 0,
        pageTop: 0,
        scale: 1
      },
      getComputedStyle(element) {
        return {
          transform: element.style?.transform ?? 'none',
          transformOrigin: element.style?.transformOrigin ?? '0px 0px 0px'
        }
      },
      addEventListener() {},
      requestAnimationFrame(callback) {
        const id = nextRaf++
        rafs.set(id, callback)
        return id
      },
      cancelAnimationFrame(id) {
        rafs.delete(id)
      },
      setTimeout(callback) {
        const id = nextTimer++
        timers.set(id, callback)
        return id
      },
      clearTimeout(id) {
        timers.delete(id)
      },
      ReactNativeWebView: {
        postMessage(raw) {
          const current = document.getElementById('terminal-surface')
          messages.push({ payload: JSON.parse(raw), surface: current?.name ?? 'none' })
        }
      }
    }

    function stepNamed(name) {
      const entry = [...rafs.entries()].find(([, callback]) => callback.name === name)
      assert(
        entry,
        `expected pending rAF named ${name}; pending=${[...rafs.values()].map((callback) => callback.name || '(anonymous)').join(',')}`
      )
      rafs.delete(entry[0])
      entry[1](Date.now())
    }
    function stepAnonymous() {
      stepNamed('')
    }
    function countNamed(name) {
      return [...rafs.values()].filter((callback) => callback.name === name).length
    }

    const factorySource = `
var window = windowObject;
var document = documentObject;
var currentTextScale = 1;
var terminalGeneration = 0;
var fitRetryToken = 0;
var fitCommitCallback = null;
var pendingSurfaceSwap = null;
var ready = true;
var everReady = true;
var statusDotPendingSelector = false;
var writesDraining = false;
var writeQueue = [];
var writeQueueHead = 0;
var termObserverDisposables = [];
var afterDrainCallbacks = [];
var linesEverWritten = 0;
var selMode = 'navigate';
var sel = null;
var selectionOverlay = { classList: { remove: function() {} } };
var initRows = 53;
var firstDataPending = false;
var smoothScrollOffsetY = 0;
var mouseModeScanTail = '';
var trackedMouseTrackingMode = 'none';
var sgrMouseMode = false;
var sgrMousePixelsMode = false;
var lastEmittedModes = {};
var activeAltScreenSnapshot = false;
var initialOscLinks = [];
var initialOscLinkRowOffset = 0;
var initialOscLinkEvictionReady = false;
var currentScale = 0.838;
var userScale = 1;
var panX = 0;
var panY = 0;
var terminalTheme = {};
var terminalFontFamily = 'monospace';
var surface = initialSurface;
var term = initialTerm;
var notifyEvents = [];
function Terminal(options) { return makeTerminal('terminal-' + (++terminalSerial), options); }
function getCellWidth() { return 4; }
function getCellHeight() { return 9; }
function getTotalScale() { return currentScale * userScale; }
function computeFitScale() { return 0.838; }
function updateTransform() { surface.style.transform = 'matrix(' + currentScale + ', 0, 0, ' + currentScale + ', ' + panX + ', ' + panY + ')'; }
function adjustRowsForViewport() {}
function repositionOverlay() {}
function flog() {}
function normalizeWriteData(data) { return data; }
function normalizeInitialData(data) { return typeof data === 'string' ? data : ''; }
function updateMouseModeFromData() {}
function isAltScreenActive() { return false; }
function normalizeStatusDotPresentation(data) { return data; }
function logFeedAndEvict() {}
function updateScrollIndicator() {}
function stopEdgeScroll() {}
function emitModesIfChanged() {}
function emitKeyboardAvoidanceMetrics() {}
function resetKeyboardAvoidanceMetrics() {}
function prepareInitSurface() { return prepareInitSurfaceActual(); }
function prepareInitSurfaceActual() { return prepareInitSurfaceImpl(); }
function attachSurfaceEventHandlers() {}
function applyTerminalTheme() {}
function fontPxForScale(scale) { return scale * 12; }
function captureInitialOscLinkTexts() {}
function notify(message) { notifyEvents.push(message); }
function requestAnimationFrame(callback) { return window.requestAnimationFrame(callback); }
function cancelAnimationFrame(id) { return window.cancelAnimationFrame(id); }
${runtimeHelpers}
${swapFunctions}
${probeScript}
${fitSource}
${finishFitSource}
${initSource}
return { init: init, geometryProbe: geometryProbe, state: function() { return { surface: surface, term: term, pendingSurfaceSwap: pendingSurfaceSwap, currentScale: currentScale, ready: ready, terminalGeneration: terminalGeneration, notifyEvents: notifyEvents }; } };
`

    const assembled = factorySource

    const makeRuntime = new Function(
      'windowObject',
      'documentObject',
      'initialSurface',
      'initialTerm',
      'makeTerminal',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'terminalSerial',
      assembled
    )
    const initialTerm = makeTerminal('A', { cols: 120, rows: 53 })
    initialTerm.open(A)
    const runtime = makeRuntime(
      windowObject,
      document,
      A,
      initialTerm,
      makeTerminal,
      windowObject.requestAnimationFrame,
      windowObject.cancelAnimationFrame,
      terminalSerial
    )

    // Active probe on the already-fitted, visible A surface.
    runtime.geometryProbe.setActive(true)
    stepNamed('sample')
    assert.equal(messages.length, 1)
    assert.equal(messages[0].surface, 'A')
    assert.equal(A.style.visibility, 'visible')

    // Run the actual init(B) and allow its real ready/replay continuation to queue fit B.
    runtime.init(120, 53, '', {}, 1, false, [])
    assert.equal(A.style.visibility, 'visible')
    const B = surfaces.find((item) => item.name === 'surface-1')
    assert(B, 'B replacement surface should be created')
    assert.equal(B.style.visibility, 'hidden')
    assert.equal(countNamed('sample'), 0, 'init(B) must cancel A probe rAF automatically')
    stepAnonymous() // actual init(B) rAF; queues actual fit attempt B
    assert.equal(countNamed('attempt'), 1)

    // Actual init(C) supersedes B before B fit; it must retain A and discard hidden B.
    runtime.init(120, 53, '', {}, 1, false, [])
    const C = surfaces.find((item) => item.name === 'surface-2')
    assert(C, 'C replacement surface should be created')
    assert.equal(A.removed, false, 'A must remain mounted until C commits')
    assert.equal(A.style.visibility, 'visible')
    assert.equal(B.removed, true, 'superseded hidden B must be discarded')
    assert.equal(B.terminal.disposed, true, 'superseded B terminal must be disposed')
    assert.equal(initialTerm.disposed, false, 'A terminal must remain alive until C commits')
    assert.equal(B.style.visibility, 'hidden', 'B must never be revealed')
    assert.equal(C.style.visibility, 'hidden')

    // Run B's stale real fit rAF after C supersedes its token. It must do nothing.
    stepNamed('attempt')
    assert.equal(C.style.visibility, 'hidden')
    assert.equal(A.removed, false)
    assert.equal(runtime.state().notifyEvents.filter((event) => event.type === 'ready').length, 0)

    // Run actual init(C) continuation, then its actual fit commit and matching swap.
    stepAnonymous()
    assert.equal(countNamed('attempt'), 1)
    stepNamed('attempt')
    assert.equal(C.style.visibility, 'visible')
    assert.equal(B.style.visibility, 'hidden')
    assert.equal(A.removed, true)
    assert.equal(initialTerm.disposed, true, 'A terminal is disposed only after C reveal')
    assert.equal(runtime.state().term.name, 'terminal-2')
    assert.equal(
      runtime.state().notifyEvents.filter((event) => event.type === 'ready').length,
      1,
      'only C may announce ready'
    )
    assert.equal(countNamed('sample'), 1, 'probe should resume only after matching C fit commit')
    stepNamed('sample')
    assert.equal(messages.length, 2)
    assert.deepEqual(
      messages.map((entry) => entry.surface),
      ['A', 'surface-2'],
      'hidden B/C must never be sampled'
    )
    assert.equal(messages[1].payload.reason, 'init')
    assert.equal(messages[1].payload.geometry['surface.x'], 0)
    assert.equal(messages[1].payload.geometry['surface.y'], 0)
    assert.equal(messages[1].payload.geometry['transform.a'], 0.838)
    assert.equal(messages[1].payload.geometry['transform.tx'], 0)

    // Exercise the real probe cap with changing geometry, then verify cleanup and window cap.
    runtime.geometryProbe.stop()
    runtime.geometryProbe.start('fit') // third allowed window for this WebView generation
    stepNamed('sample')
    assert.equal(countNamed('sample'), 1)
    runtime.geometryProbe.stop()
    runtime.geometryProbe.start('fit') // fourth window is rejected
    assert.equal(countNamed('sample'), 0)
    runtime.geometryProbe.start('active') // still rejected at the three-window budget
    assert.equal(countNamed('sample'), 0)
    // Resetting is not part of production flow; use the active third window before exhausting it instead.
    // The third window was consumed above; a fourth is refused by the actual probe.
    assert.equal(messages.length, 3)
    assert([...messages].every((entry) => entry.payload.frame <= 3600))

    function runRecordBudget() {
      let now = 1000
      let id = 1
      const budgetFrames = new Map()
      const budgetTimers = new Map()
      const budgetRecords = []
      const rect = { x: 0, y: 0, width: 320, height: 600 }
      const box = (getRect, w, h, querySelector = () => null) => ({
        clientWidth: w,
        clientHeight: h,
        getBoundingClientRect: getRect,
        querySelector
      })
      const budgetCanvas = box(
        () => ({
          ...rect,
          left: rect.x,
          top: rect.y,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height
        }),
        320,
        600
      )
      const budgetXterm = box(
        () => ({
          ...rect,
          left: rect.x,
          top: rect.y,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height
        }),
        320,
        600,
        () => budgetCanvas
      )
      const budgetSurface = {
        style: { transform: 'matrix(1, 0, 0, 1, 0, 0)', transformOrigin: '0px 0px 0px' },
        clientWidth: 320,
        clientHeight: 600,
        getBoundingClientRect: () => ({
          ...rect,
          left: rect.x,
          top: rect.y,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height
        })
      }
      const boxRoot = box(
        () => ({ x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 600, width: 320, height: 600 }),
        320,
        600
      )
      const budgetDocument = {
        documentElement: boxRoot,
        getElementById: (key) =>
          key === 'terminal-container' ? boxRoot : key === 'terminal-surface' ? budgetSurface : null
      }
      const budgetWindow = {
        innerWidth: 320,
        innerHeight: 600,
        pageXOffset: 0,
        pageYOffset: 0,
        visualViewport: {
          width: 320,
          height: 600,
          offsetLeft: 0,
          offsetTop: 0,
          pageLeft: 0,
          pageTop: 0,
          scale: 1
        },
        getComputedStyle: (el) => ({
          transform: el.style.transform,
          transformOrigin: el.style.transformOrigin
        }),
        addEventListener() {},
        requestAnimationFrame: (cb) => {
          const key = id++
          budgetFrames.set(key, cb)
          return key
        },
        cancelAnimationFrame: (key) => budgetFrames.delete(key),
        setTimeout: (cb) => {
          const key = id++
          budgetTimers.set(key, cb)
          return key
        },
        clearTimeout: (key) => budgetTimers.delete(key),
        ReactNativeWebView: { postMessage: (raw) => budgetRecords.push(JSON.parse(raw)) }
      }
      const sandbox = {
        window: budgetWindow,
        document: budgetDocument,
        surface: budgetSurface,
        term: { cols: 40, rows: 24, element: budgetXterm },
        panX: 0,
        panY: 0,
        currentScale: 1,
        userScale: 1,
        getTotalScale: () => 1,
        getCellWidth: () => 8,
        getCellHeight: () => 16,
        Date: { now: () => now },
        requestAnimationFrame: budgetWindow.requestAnimationFrame,
        cancelAnimationFrame: budgetWindow.cancelAnimationFrame
      }
      runInNewContext(probeScript, sandbox)
      const probe = sandbox.geometryProbe
      probe.setActive(true)
      for (let x = 0; x < 40 && budgetRecords.length < 24; x++) {
        const item = budgetFrames.entries().next().value
        assert(item, 'probe should have one pending frame until its record cap')
        budgetFrames.delete(item[0])
        rect.x = x
        now += 16
        item[1](now)
      }
      assert.equal(budgetRecords.length, 24, 'the actual probe must enforce MAX_RECORDS')
      assert(
        budgetRecords.every((entry) => entry.frame <= 3600),
        'the actual probe must enforce MAX_FRAMES'
      )
      assert.equal(budgetFrames.size, 0, 'record-cap stop must cancel the active rAF')
      assert.equal(budgetTimers.size, 0, 'record-cap stop must clear its timeout')
      return budgetRecords.length
    }
    const budgetRecords = runRecordBudget()

    function runFrameBudget() {
      let now = 2000
      let id = 1
      const pending = new Map()
      const timeoutIds = new Map()
      let frameCount = 0
      const bounds = {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 320,
        bottom: 600,
        width: 320,
        height: 600
      }
      const canvas = { clientWidth: 320, clientHeight: 600, getBoundingClientRect: () => bounds }
      const xterm = {
        clientWidth: 320,
        clientHeight: 600,
        getBoundingClientRect: () => bounds,
        querySelector: () => canvas
      }
      const stableSurface = {
        clientWidth: 320,
        clientHeight: 600,
        style: { transform: 'matrix(1, 0, 0, 1, 0, 0)', transformOrigin: '0px 0px 0px' },
        getBoundingClientRect: () => bounds
      }
      const stableRoot = {
        clientWidth: 320,
        clientHeight: 600,
        getBoundingClientRect: () => bounds
      }
      const stableDoc = {
        documentElement: stableRoot,
        getElementById: (key) =>
          key === 'terminal-container'
            ? stableRoot
            : key === 'terminal-surface'
              ? stableSurface
              : null
      }
      const stableWindow = {
        innerWidth: 320,
        innerHeight: 600,
        pageXOffset: 0,
        pageYOffset: 0,
        visualViewport: {
          width: 320,
          height: 600,
          offsetLeft: 0,
          offsetTop: 0,
          pageLeft: 0,
          pageTop: 0,
          scale: 1
        },
        getComputedStyle: (element) => ({
          transform: element.style.transform,
          transformOrigin: element.style.transformOrigin
        }),
        addEventListener() {},
        requestAnimationFrame: (callback) => {
          const key = id++
          pending.set(key, callback)
          return key
        },
        cancelAnimationFrame: (key) => pending.delete(key),
        setTimeout: (callback) => {
          const key = id++
          timeoutIds.set(key, callback)
          return key
        },
        clearTimeout: (key) => timeoutIds.delete(key),
        ReactNativeWebView: { postMessage() {} }
      }
      const frameSandbox = {
        window: stableWindow,
        document: stableDoc,
        surface: stableSurface,
        term: { cols: 40, rows: 24, element: xterm },
        panX: 0,
        panY: 0,
        currentScale: 1,
        userScale: 1,
        getTotalScale: () => 1,
        getCellWidth: () => 8,
        getCellHeight: () => 16,
        Date: { now: () => now },
        requestAnimationFrame: stableWindow.requestAnimationFrame,
        cancelAnimationFrame: stableWindow.cancelAnimationFrame
      }
      runInNewContext(probeScript, frameSandbox)
      frameSandbox.geometryProbe.setActive(true)
      while (pending.size > 0 && frameCount < 3601) {
        const [key, callback] = pending.entries().next().value
        pending.delete(key)
        frameCount++
        now += 8
        callback(now)
      }
      assert.equal(frameCount, 3600, 'the actual probe must stop at MAX_FRAMES')
      assert.equal(pending.size, 0, 'frame-budget stop must cancel scheduled work')
      assert.equal(timeoutIds.size, 0, 'frame-budget stop must clear its timeout')
      return frameCount
    }
    const frameBudgetFrames = runFrameBudget()

    assert.equal(
      messages.filter((entry) => entry.surface === 'B' || entry.surface === 'surface-1').length,
      0
    )
    assert.equal(rafs.size, 0)
    assert.equal(timers.size, 0)
    assert.equal(budgetRecords, 24)
    assert.equal(frameBudgetFrames, 3600)
  })
})
