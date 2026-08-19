import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(null))
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) =>
    (execFileMock as unknown as (...a: unknown[]) => void)(...args)
}))

const { openNativeTerminalAt } = await import('./terminal-launch')

describe('openNativeTerminalAt', () => {
  let dir: string
  const originalPlatform = process.platform

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-terminal-'))
    execFileMock.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('rejects a path that does not exist without spawning anything', async () => {
    await expect(openNativeTerminalAt(path.join(dir, 'does-not-exist'))).rejects.toThrow(/doesn't exist/)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('opens Terminal.app on macOS via execFile (no shell string)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    await openNativeTerminalAt(dir)
    expect(execFileMock).toHaveBeenCalledWith('open', ['-a', 'Terminal', dir], expect.any(Function))
  })
})
