import { describe, expect, it } from 'vitest'
import {
  createTerminalWebViewGeometryRecord,
  createTerminalWebViewDiagnosticKey,
  createTerminalWebViewLifecycleReporter,
  createTerminalWebViewNativeErrorHandlers,
  reportTerminalWebViewActiveState,
  TERMINAL_WEBVIEW_GEOMETRY_PROBE_LIMITS
} from './terminal-webview-lifecycle-diagnostics'

describe('terminal WebView lifecycle diagnostics', () => {
  it('Given a terminal handle When a diagnostic key is created Then it is stable and omits the raw handle', () => {
    const handle = 'host-specific-terminal-id'
    const key = createTerminalWebViewDiagnosticKey(handle)

    expect(key).toBe(createTerminalWebViewDiagnosticKey(handle))
    expect(key).not.toContain(handle)
  })

  it('Given a lifecycle transition When recorded Then it identifies time, generation, and visibility', () => {
    let snapshot = {
      terminalKey: 'terminal-abc',
      generation: 3,
      active: false,
      enabled: true
    }
    const logged: unknown[] = []
    const times = [500, 1234, 1400]
    const report = createTerminalWebViewLifecycleReporter(
      () => snapshot,
      (record) => logged.push(record),
      () => times.shift() ?? 0
    )
    report('load-start')
    snapshot = { ...snapshot, generation: 4, active: true }
    report('content-process-ended')

    expect(logged).toEqual([
      {
        terminalKey: 'terminal-abc',
        event: 'load-start',
        generation: 3,
        active: false,
        atMs: 1234,
        sincePreviousEventMs: 734
      },
      {
        terminalKey: 'terminal-abc',
        event: 'content-process-ended',
        generation: 4,
        active: true,
        atMs: 1400,
        sincePreviousEventMs: 166
      }
    ])
  })

  it('Given native WebView errors When reported Then lifecycle records and engine errors retain their event data', () => {
    const lifecycleEvents: string[] = []
    const engineErrors: Array<{ message: string; event: object }> = []
    const handlers = createTerminalWebViewNativeErrorHandlers(
      (event) => lifecycleEvents.push(event),
      (message, event: object) => engineErrors.push({ message, event })
    )
    const event = { nativeEvent: { description: 'content process ended' } }

    handlers.onContentProcessDidTerminate(event)

    expect(lifecycleEvents).toEqual(['content-process-ended'])
    expect(engineErrors).toEqual([{ message: 'Terminal WebView content process ended', event }])
  })

  it('Given diagnostics are disabled When lifecycle events arrive Then nothing is logged', () => {
    const logged: unknown[] = []
    const report = createTerminalWebViewLifecycleReporter(
      () => ({
        terminalKey: 'terminal-abc',
        generation: 3,
        active: false,
        enabled: false
      }),
      (record) => logged.push(record),
      () => 1234
    )

    report('content-process-ended')

    expect(logged).toEqual([])
  })

  it('Given an active probe sample When it is bridged Then it adds only pseudonymous lifecycle context and numeric geometry', () => {
    const sample = {
      type: 'geometry-probe',
      reason: 'fit',
      frame: 4,
      sampledAtMs: 5000,
      elapsedMs: 66,
      geometry: {
        'surface.x': 5.15,
        'surface.y': 5.15,
        'surface.width': 320,
        'surface.height': 600,
        'transform.tx': 5.15,
        'transform.ty': 5.15,
        'transform.a': 0.9,
        'transform.d': 0.9,
        visualViewportOffsetTop: 0
      }
    }
    const record = createTerminalWebViewGeometryRecord(
      { terminalKey: 'terminal-abc', generation: 1, active: true, enabled: true },
      sample,
      5060
    )

    expect(record).toEqual({
      terminalKey: 'terminal-abc',
      generation: 1,
      active: true,
      enabled: true,
      event: 'geometry-probe',
      reason: 'fit',
      frame: 4,
      sampledAtMs: 5000,
      elapsedMs: 66,
      receivedAtMs: 5060,
      geometry: sample.geometry
    })
    expect(record).not.toHaveProperty('terminalHandle')
    expect(TERMINAL_WEBVIEW_GEOMETRY_PROBE_LIMITS).toEqual({
      maxFrames: 3600,
      maxRecordsPerWindow: 24,
      maxWindowMs: 30000,
      maxWindowsPerGeneration: 3
    })
  })

  it('Given an active diagnostic pane When RN reports visibility Then it sends the bounded probe activation command', () => {
    const events: string[] = []
    const commands: Array<{ type: 'geometry-probe'; active: boolean }> = []
    reportTerminalWebViewActiveState(
      true,
      true,
      (event) => events.push(event),
      (command) => commands.push(command)
    )

    expect(events).toEqual(['active-state'])
    expect(commands).toEqual([{ type: 'geometry-probe', active: true }])
  })

  it('Given an invalid or inactive probe When it is bridged Then no geometry record is emitted', () => {
    const validSample = {
      type: 'geometry-probe',
      reason: 'active',
      frame: 1,
      sampledAtMs: 5000,
      elapsedMs: 0,
      geometry: { 'surface.x': 1 }
    }
    const activeSnapshot = {
      terminalKey: 'terminal-abc',
      generation: 1,
      active: true,
      enabled: true
    }

    expect(createTerminalWebViewGeometryRecord(activeSnapshot, validSample, 5001)).not.toBeNull()
    expect(
      createTerminalWebViewGeometryRecord({ ...activeSnapshot, active: false }, validSample, 5001)
    ).toBeNull()
    expect(
      createTerminalWebViewGeometryRecord(
        activeSnapshot,
        {
          ...validSample,
          geometry: { 'surface.x': 'terminal text must not cross this bridge' }
        },
        5001
      )
    ).toBeNull()
    expect(
      createTerminalWebViewGeometryRecord(
        activeSnapshot,
        {
          ...validSample,
          geometry: { 'terminal text must not cross this bridge': 1 }
        },
        5001
      )
    ).toBeNull()
    expect(
      createTerminalWebViewGeometryRecord(
        activeSnapshot,
        {
          ...validSample,
          frame: 3601
        },
        5001
      )
    ).toBeNull()
    expect(
      createTerminalWebViewGeometryRecord(
        activeSnapshot,
        {
          ...validSample,
          elapsedMs: 30001
        },
        5001
      )
    ).toBeNull()
  })
})
