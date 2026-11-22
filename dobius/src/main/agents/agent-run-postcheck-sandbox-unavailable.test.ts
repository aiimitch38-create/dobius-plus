import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runAutomationPrecheck: vi.fn(), probeError: 'sandbox_apply: Operation not permitted' }))

vi.mock('../automations/precheck-runner', () => ({ runAutomationPrecheck: mocks.runAutomationPrecheck }))
vi.mock('../storage/user-data-root', () => ({ getUserDataRoot: () => '/tmp/dobius-user-data' }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  // The sandbox probe: sandbox-exec refuses to apply the profile.
  execFile: (
    _file: string,
    _args: string[],
    _options: object,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => callback(new Error('exit 71'), '', mocks.probeError)
}))

import { runSandboxedPostcheck } from './agent-run-postcheck-sandbox'

const realPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform })
  mocks.runAutomationPrecheck.mockReset()
})

describe('runSandboxedPostcheck when the sandbox cannot be used', () => {
  it.skipIf(realPlatform !== 'darwin')(
    'does not run the check when the profile fails to apply',
    async () => {
      const outcome = await runSandboxedPostcheck({
        postcheck: { command: 'npm test', timeoutSeconds: 60 },
        cwd: process.cwd()
      })
      expect(outcome).toEqual({
        ok: false,
        reason: 'the sandbox did not start (sandbox_apply: Operation not permitted)'
      })
      expect(mocks.runAutomationPrecheck).not.toHaveBeenCalled()
    }
  )

  it('does not run the check on a system with no sandbox-exec', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const outcome = await runSandboxedPostcheck({
      postcheck: { command: 'npm test', timeoutSeconds: 60 },
      cwd: process.cwd()
    })
    expect(outcome).toEqual({ ok: false, reason: 'no sandbox is available on this system' })
    expect(mocks.runAutomationPrecheck).not.toHaveBeenCalled()
  })
})
