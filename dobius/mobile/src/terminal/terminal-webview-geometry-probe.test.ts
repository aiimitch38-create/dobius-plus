import { runInNewContext, Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { XTERM_WEBVIEW_SOURCE } from './terminal-webview-html'
import { TERMINAL_WEBVIEW_GEOMETRY_PROBE_SCRIPT } from './terminal-webview-geometry-probe'

function createProbeHarness() {
  let now = 1000
  let nextId = 1
  const frames = new Map<number, FrameRequestCallback>()
  const timers = new Map<number, () => void>()
  const listeners = new Map<string, () => void>()
  const records: Array<Record<string, unknown>> = []
  let frameCount = 0
  const surfaceRect = { x: 0, y: 0, width: 320, height: 600 }
  let transform = 'matrix(0.9, 0, 0, 0.9, 0, 0)'

  function element(rect: typeof surfaceRect) {
    return {
      clientWidth: rect.width,
      clientHeight: rect.height,
      getBoundingClientRect: () => ({
        ...rect,
        left: rect.x,
        top: rect.y,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height
      }),
      querySelector: (_selector: string) => null
    }
  }

  const canvas = element({ x: 0, y: 0, width: 320, height: 600 })
  const xterm = {
    ...element({ x: 0, y: 0, width: 320, height: 600 }),
    querySelector: (_selector: string) => canvas
  }
  const surface = {
    ...element(surfaceRect),
    style: { transformOrigin: '0px 0px 0px' }
  }
  const container = element({ x: 0, y: 0, width: 320, height: 600 })
  const root = element({ x: 0, y: 0, width: 320, height: 600 })
  const document = {
    documentElement: root,
    getElementById: (id: string) =>
      id === 'terminal-container' ? container : id === 'terminal-surface' ? surface : null
  }
  const window = {
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
    getComputedStyle: () => ({
      transform,
      transformOrigin: surface.style.transformOrigin
    }),
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = nextId++
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void) => {
      const id = nextId++
      timers.set(id, callback)
      return id
    },
    clearTimeout: (id: number) => timers.delete(id),
    ReactNativeWebView: {
      postMessage: (message: string) => records.push(JSON.parse(message) as Record<string, unknown>)
    }
  }
  const sandbox = {
    window,
    document,
    surface,
    term: { element: xterm, cols: 40, rows: 24 },
    panX: 0,
    panY: 0,
    currentScale: 0.9,
    userScale: 1,
    getTotalScale: () => 0.9,
    getCellWidth: () => 8,
    getCellHeight: () => 16,
    Date: { now: () => now }
  }
  runInNewContext(TERMINAL_WEBVIEW_GEOMETRY_PROBE_SCRIPT, sandbox)

  return {
    records,
    frames,
    timers,
    listeners,
    probe: (sandbox as typeof sandbox & { geometryProbe: ProbeController }).geometryProbe,
    setSurfacePosition: (x: number, y: number) => {
      surfaceRect.x = x
      surfaceRect.y = y
      transform = `matrix(0.9, 0, 0, 0.9, ${x}, ${y})`
    },
    setTransform: (value: string) => {
      transform = value
    },
    stepFrame: () => {
      const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined
      if (!next) {
        return false
      }
      frames.delete(next[0])
      frameCount += 1
      now += 16
      next[1](now)
      return true
    },
    runFrameWindow: () => {
      let steps = 0
      while (frames.size > 0 && steps < 4000) {
        if (frames.size > 1) {
          throw new Error('geometry probe scheduled multiple rAF callbacks')
        }
        steps += 1
        const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined
        if (!next) {
          break
        }
        frames.delete(next[0])
        frameCount += 1
        now += 8
        next[1](now)
      }
      return steps
    },
    frameCount: () => frameCount,
    advanceTime: (deltaMs: number) => {
      now += deltaMs
    },
    fireTimer: () => {
      const next = timers.entries().next().value as [number, () => void] | undefined
      if (!next) {
        return false
      }
      next[1]()
      return true
    }
  }
}

type ProbeController = {
  start(reason: string): void
  setActive(active: boolean): void
  stop(): void
  noteOutput(): void
  noteRender(): void
}

describe('terminal WebView geometry probe', () => {
  it('Given the shipped WebView HTML When diagnostic source is assembled Then it contains the bounded numeric probe', () => {
    const html = XTERM_WEBVIEW_SOURCE.html
    const probeOffset = html.indexOf(TERMINAL_WEBVIEW_GEOMETRY_PROBE_SCRIPT)
    const scriptStart = html.lastIndexOf('<script', probeOffset)
    const scriptBodyStart = html.indexOf('>', scriptStart) + 1
    const scriptEnd = html.indexOf('</script>', probeOffset)

    expect(probeOffset).toBeGreaterThanOrEqual(0)
    expect(html).toContain("msg.type === 'geometry-probe'")
    expect(html).toContain('geometryProbe.noteOutput()')
    expect(html).toContain('geometryProbe.noteRender()')
    expect(TERMINAL_WEBVIEW_GEOMETRY_PROBE_SCRIPT).toContain('MAX_FRAMES = 3600')
    expect(TERMINAL_WEBVIEW_GEOMETRY_PROBE_SCRIPT).toContain('MAX_RECORDS = 24')
    expect(TERMINAL_WEBVIEW_GEOMETRY_PROBE_SCRIPT).toContain('MAX_WINDOW_MS = 30000')
    expect(TERMINAL_WEBVIEW_GEOMETRY_PROBE_SCRIPT).toContain('MAX_WINDOWS_PER_GENERATION = 3')
    expect(() => new Script(html.slice(scriptBodyStart, scriptEnd))).not.toThrow()
  })

  it('Given a brief surface translation When sampled per animation frame Then it records the move and recovery numerically', () => {
    const harness = createProbeHarness()
    harness.probe.setActive(true)
    harness.probe.start('active')
    harness.stepFrame()
    harness.setSurfacePosition(5.15, 5.15)
    harness.stepFrame()
    harness.setSurfacePosition(0, 0)
    harness.stepFrame()

    const records = harness.records as Array<{
      frame: number
      reason: string
      geometry: Record<string, number>
    }>
    expect(records.map(({ geometry }) => geometry['surface.x'])).toEqual([0, 5.15, 0])
    expect(records.map(({ geometry }) => geometry['surface.y'])).toEqual([0, 5.15, 0])
    expect(records[1]?.reason).toBe('active')
    expect(records[1]?.geometry['container.x']).toBe(0)
    expect(records[1]?.geometry['transform.tx']).toBe(5.15)
    expect(records.every(({ frame }) => frame <= 3600)).toBe(true)
    expect(JSON.stringify(records)).not.toContain('terminal text')
  })

  it('Given a matrix3d transform When sampled Then translation uses the matrix arguments without the function name', () => {
    const harness = createProbeHarness()
    harness.probe.setActive(true)
    harness.stepFrame()
    harness.setTransform('matrix3d(0.9, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 1, 0, 5.15, 6.25, 0, 1)')
    harness.stepFrame()

    const geometry = (harness.records[1]?.geometry ?? {}) as Record<string, number>
    expect(geometry['transform.tx']).toBe(5.15)
    expect(geometry['transform.ty']).toBe(6.25)
    expect(geometry['transform.a']).toBe(0.9)
    expect(geometry['transform.d']).toBe(0.9)
  })

  it('Given output and render cadence When geometry changes Then the record includes only numeric cadence', () => {
    const harness = createProbeHarness()
    harness.probe.setActive(true)
    harness.stepFrame()
    harness.probe.noteOutput()
    harness.advanceTime(40)
    harness.probe.noteOutput()
    harness.advanceTime(16)
    harness.probe.noteRender()
    harness.probe.start('fit')
    harness.setSurfacePosition(1, 1)
    harness.stepFrame()

    const geometry = (harness.records[1]?.geometry ?? {}) as Record<string, number>
    expect(geometry.outputCount).toBe(2)
    expect(geometry.outputIntervalMs).toBe(40)
    expect(geometry.renderCount).toBe(1)
    expect(geometry.renderIntervalMs).toBe(0)
    expect(geometry.fitPassCount).toBe(1)
    expect(geometry.fitIntervalMs).toBe(0)
  })

  it('Given repeated geometry changes When record budget is exhausted Then the rAF and timer are cleaned up', () => {
    const harness = createProbeHarness()
    harness.probe.setActive(true)
    harness.probe.start('fit')

    let x = 1
    while (harness.frames.size > 0 && harness.records.length < 30) {
      harness.setSurfacePosition(x, x)
      x += 1
      harness.stepFrame()
    }

    expect(harness.records).toHaveLength(24)
    expect(harness.frames.size).toBe(0)
    expect(harness.timers.size).toBe(0)
  })

  it('Given an active observation When it is deactivated or times out Then all scheduled work is cancelled', () => {
    const deactivated = createProbeHarness()
    deactivated.probe.setActive(true)
    deactivated.probe.start('active')
    deactivated.probe.setActive(false)
    expect(deactivated.frames.size).toBe(0)
    expect(deactivated.timers.size).toBe(0)
    expect(deactivated.records).toHaveLength(0)

    const timedOut = createProbeHarness()
    timedOut.probe.setActive(true)
    timedOut.probe.start('init')
    timedOut.advanceTime(30000)
    expect(timedOut.fireTimer()).toBe(true)
    expect(timedOut.frames.size).toBe(0)
    expect(timedOut.timers.size).toBe(0)
    timedOut.probe.setActive(true)
    expect(timedOut.frames.size).toBe(0)

    const pageHidden = createProbeHarness()
    pageHidden.probe.setActive(true)
    pageHidden.listeners.get('pagehide')?.()
    expect(pageHidden.frames.size).toBe(0)
    expect(pageHidden.timers.size).toBe(0)

    const resumed = createProbeHarness()
    resumed.probe.setActive(true)
    resumed.probe.setActive(false)
    resumed.probe.setActive(true)
    expect(resumed.frames.size).toBe(1)
    expect(resumed.timers.size).toBe(1)
    resumed.probe.setActive(false)
    resumed.probe.setActive(true)
    expect(resumed.frames.size).toBe(1)
    resumed.probe.setActive(false)
    resumed.probe.setActive(true)
    expect(resumed.frames.size).toBe(0)
  })

  it('Given sustained active use When its cumulative 30-second window or 3600-frame cap is spent Then no fourth window starts', () => {
    const harness = createProbeHarness()
    harness.probe.setActive(true)
    harness.probe.start('fit')
    expect(harness.runFrameWindow()).toBe(3600)
    harness.probe.start('fit')

    expect(harness.frames.size).toBe(0)
    harness.probe.setActive(false)
    harness.probe.setActive(true)
    expect(harness.frames.size).toBe(0)
    const reloadedDocument = createProbeHarness()
    reloadedDocument.probe.setActive(true)
    reloadedDocument.probe.start('init')
    expect(reloadedDocument.frames.size).toBe(1)
  })

  it('Given init and fit triggers during an active window When geometry is unchanged Then numeric reason samples mark each trigger', () => {
    const harness = createProbeHarness()
    harness.probe.setActive(true)
    harness.stepFrame()
    harness.probe.start('init')
    harness.stepFrame()
    harness.probe.start('fit')
    harness.stepFrame()
    harness.probe.start('fit')
    harness.probe.start('fit')
    harness.stepFrame()

    expect(harness.records.map((record) => record.reason)).toEqual(['active', 'init', 'fit'])
  })
})
