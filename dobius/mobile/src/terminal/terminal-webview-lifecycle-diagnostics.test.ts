import { describe, expect, it } from 'vitest'
import {
  createTerminalWebViewDiagnosticKey,
  createTerminalWebViewLifecycleRecord
} from './terminal-webview-lifecycle-diagnostics'

describe('terminal WebView lifecycle diagnostics', () => {
  it('Given a terminal handle When a diagnostic key is created Then it is stable and omits the raw handle', () => {
    const handle = 'host-specific-terminal-id'
    const key = createTerminalWebViewDiagnosticKey(handle)

    expect(key).toBe(createTerminalWebViewDiagnosticKey(handle))
    expect(key).not.toContain(handle)
  })

  it('Given a lifecycle transition When recorded Then it identifies time, generation, and visibility', () => {
    const record = createTerminalWebViewLifecycleRecord({
      terminalKey: 'terminal-abc',
      event: 'content-process-ended',
      generation: 3,
      active: false,
      atMs: 1234
    })

    expect(record).toEqual({
      terminalKey: 'terminal-abc',
      event: 'content-process-ended',
      generation: 3,
      active: false,
      atMs: 1234
    })
  })
})
