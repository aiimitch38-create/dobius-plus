import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveAgentRunCwd, resolveAgentRunCwdPath } from './agent-runner-environment'

describe('resolveAgentRunCwd (BUILD-005 #23)', () => {
  let base = ''

  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'agent-cwd-'))
  })

  afterEach(() => {
    chmodSync(base, 0o700)
    for (const entry of ['locked', 'locked-parent']) {
      const target = path.join(base, entry)
      try {
        chmodSync(target, 0o700)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
    }
    rmSync(base, { recursive: true, force: true })
  })

  it('creates a missing workspace folder and runs there', () => {
    const cwd = path.join(base, 'fresh', 'workspace')
    expect(resolveAgentRunCwd(cwd)).toBe(cwd)
    expect(statSync(cwd).isDirectory()).toBe(true)
  })

  it('rejects a folder that cannot be created instead of falling back to home', () => {
    const lockedParent = path.join(base, 'locked-parent')
    mkdirSync(lockedParent)
    chmodSync(lockedParent, 0o500)
    const cwd = path.join(lockedParent, 'workspace')
    expect(() => resolveAgentRunCwd(cwd)).toThrow(/Agent working folder cannot be used/)
  })

  it('rejects an existing folder the agent cannot write to', () => {
    const locked = path.join(base, 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o500)
    let returned: string | undefined
    expect(() => {
      returned = resolveAgentRunCwd(locked)
    }).toThrow(locked)
    expect(returned).not.toBe(os.homedir())
  })

  it('rejects a cwd that is a file, never substituting the home folder', () => {
    const file = path.join(base, 'not-a-dir')
    writeFileSync(file, 'x')
    expect(() => resolveAgentRunCwd(file)).toThrow(/cannot be used/)
  })

  // B2 run-adoption gate: ADAM is asked about the path before the folder exists.
  it('resolves the path for ADAM admission without creating the folder', () => {
    const cwd = path.join(base, 'not-yet', 'workspace')
    expect(resolveAgentRunCwdPath(cwd)).toBe(cwd)
    expect(resolveAgentRunCwdPath('~/x')).toBe(path.join(os.homedir(), 'x'))
    expect(existsSync(path.join(base, 'not-yet'))).toBe(false)
    expect(resolveAgentRunCwd(cwd)).toBe(cwd)
    expect(statSync(cwd).isDirectory()).toBe(true)
  })
})
