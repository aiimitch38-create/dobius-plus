import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAutomationPrecheck } from './precheck-runner'

const sshManagerState = vi.hoisted(() => ({
  manager: null as null | {
    getConnection: ReturnType<typeof vi.fn>
  }
}))

vi.mock('../ipc/ssh', () => ({
  getSshConnectionManager: () => sshManagerState.manager
}))

const node = JSON.stringify(process.execPath)

function nodeCommand(script: string): string {
  return `${node} -e ${JSON.stringify(script)}`
}

describe('runAutomationPrecheck', () => {
  let cwd = ''

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'dobius-precheck-test-'))
    sshManagerState.manager = null
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('captures exit code and output for a non-zero local precheck', async () => {
    const result = await runAutomationPrecheck({
      precheck: {
        command: nodeCommand(
          "console.log('stdout text'); console.error('stderr text'); process.exit(7)"
        ),
        timeoutSeconds: 5
      },
      target: { type: 'local', cwd }
    })

    expect(result.exitCode).toBe(7)
    expect(result.timedOut).toBe(false)
    expect(result.stdout).toContain('stdout text')
    expect(result.stderr).toContain('stderr text')
    expect(result.error).toBeNull()
  })

  it('settles as timed out even when a detached child keeps the output open', async () => {
    // The grandchild leaves the process group (so the kill misses it) and
    // inherits stdout, so `close` would not arrive until it exits.
    const script =
      "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], " +
      "{ detached: true, stdio: 'inherit' }).unref(); setTimeout(() => {}, 15000)"
    const started = Date.now()
    const result = await runAutomationPrecheck({
      precheck: { command: nodeCommand(script), timeoutSeconds: 1 },
      target: { type: 'local', cwd }
    })

    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
    expect(result.error).toContain('timed out')
    expect(Date.now() - started).toBeLessThan(8000)
  }, 12_000)

  function isRunning(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      // No such process.
      return false
    }
  }

  it('still force-kills a child that ignores SIGTERM after the output has closed', async () => {
    // The shell dies on SIGTERM and the output closes at once; the grandchild
    // ignores SIGTERM and must still get the scheduled SIGKILL.
    const script =
      "process.on('SIGTERM', () => {}); require('fs').writeFileSync('pid.txt', String(process.pid)); setTimeout(() => {}, 30000)"
    const result = await runAutomationPrecheck({
      precheck: {
        command: `${nodeCommand(script)} >/dev/null 2>&1 & sleep 30`,
        timeoutSeconds: 1
      },
      target: { type: 'local', cwd }
    })
    expect(result.timedOut).toBe(true)
    const pid = Number(readFileSync(join(cwd, 'pid.txt'), 'utf8'))
    expect(isRunning(pid)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(isRunning(pid)).toBe(false)
  }, 12_000)

  it('with requireGroupExit, stops leftover processes before it reports the result', async () => {
    const result = await runAutomationPrecheck({
      precheck: { command: 'sleep 30 >/dev/null 2>&1 & echo $! > pid.txt; exit 3', timeoutSeconds: 5 },
      target: { type: 'local', cwd, requireGroupExit: true }
    })
    expect(result.exitCode).toBe(3)
    expect(result.processGroupAlive).toBeUndefined()
    expect(isRunning(Number(readFileSync(join(cwd, 'pid.txt'), 'utf8')))).toBe(false)
  })

  it('without requireGroupExit, leaves a background process alone as before', async () => {
    const result = await runAutomationPrecheck({
      precheck: { command: 'sleep 5 >/dev/null 2>&1 & echo $! > pid.txt', timeoutSeconds: 5 },
      target: { type: 'local', cwd }
    })
    expect(result.exitCode).toBe(0)
    const pid = Number(readFileSync(join(cwd, 'pid.txt'), 'utf8'))
    expect(isRunning(pid)).toBe(true)
    process.kill(pid, 'SIGKILL')
  })

  it('marks a local precheck as timed out', async () => {
    const result = await runAutomationPrecheck({
      precheck: {
        command: nodeCommand('setTimeout(() => {}, 5000)'),
        timeoutSeconds: 1
      },
      target: { type: 'local', cwd }
    })

    expect(result.exitCode).toBeNull()
    expect(result.timedOut).toBe(true)
    expect(result.error).toBe('Precheck timed out after 1s.')
  })

  it('uses the SSH channel exit event as the precheck exit code', async () => {
    const channel = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      close: vi.fn()
    })
    sshManagerState.manager = {
      getConnection: vi.fn(() => ({
        getState: () => ({ status: 'connected' }),
        exec: vi.fn(async () => channel)
      }))
    }

    const resultPromise = runAutomationPrecheck({
      precheck: {
        command: "printf 'ready'",
        timeoutSeconds: 5
      },
      target: {
        type: 'ssh',
        cwd: '/repo/path',
        connectionId: 'ssh-1'
      }
    })
    await Promise.resolve()
    channel.emit('data', Buffer.from('ready\n'))
    channel.emit('exit', 0)
    channel.emit('close')

    const result = await resultPromise
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('ready')
    expect(result.error).toBeNull()
  })
})
