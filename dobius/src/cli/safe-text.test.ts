import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportCliError } from './format'
import { RuntimeRpcFailureError } from './runtime-client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('reportCliError strips terminal escape codes', () => {
  it('cleans an RPC failure message and its next steps before printing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportCliError(
      new RuntimeRpcFailureError({
        id: 'r',
        ok: false,
        error: {
          code: 'runtime_error',
          message: 'git pull failed: \u001b]0;owned\u0007remote said \u001b[2Jno',
          data: { nextSteps: ['retry \u001b[31mnow'] }
        },
        _meta: { runtimeId: 'rt' }
      } as never),
      false
    )
    const out = errorSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(out).not.toContain('\u001b')
    expect(out).toContain('git pull failed: remote said no')
    expect(out).toContain('retry now')
  })
})
