import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  continueAllStoppedGroups,
  isForegroundSignal,
  resetStoppedGroupsForTest,
  signalForegroundProcessGroup
} from './foreground-process-group'

const posix = process.platform !== 'win32'

// Models a terminal: the foreground group changes when the job is stopped
// (the shell takes the terminal back), exactly as an interactive zsh does.
function terminal(shellPid: number, jobPgid: number) {
  let foreground = jobPgid
  const kill = vi.fn((pid: number, sig: string) => {
    if (pid === -jobPgid && sig === 'SIGSTOP') {
      foreground = shellPid
    }
  })
  const write = vi.fn((data: string) => {
    if (data === 'fg\r' && foreground === shellPid) {
      foreground = jobPgid
    }
  })
  return { kill, write, readGroup: async () => foreground, foreground: () => foreground }
}

describe('signalForegroundProcessGroup', () => {
  beforeEach(() => resetStoppedGroupsForTest())

  it.runIf(posix)(
    'stops the agent job, then resumes THAT group and gives it the terminal back',
    async () => {
      const t = terminal(100, 250)
      expect(await signalForegroundProcessGroup(100, 'SIGSTOP_FOREGROUND', t)).toBe('signalled')
      expect(t.kill).toHaveBeenCalledWith(-250, 'SIGSTOP')
      expect(t.foreground()).toBe(100)
      expect(await signalForegroundProcessGroup(100, 'SIGCONT_FOREGROUND', t)).toBe('signalled')
      expect(t.kill).toHaveBeenLastCalledWith(-250, 'SIGCONT')
      expect(t.write).toHaveBeenCalledWith('fg\r')
      expect(t.foreground()).toBe(250)
    }
  )

  it.runIf(posix)(
    'refuses to pause a bare prompt, and resume without a pause does nothing',
    async () => {
      const t = terminal(100, 100)
      expect(await signalForegroundProcessGroup(100, 'SIGSTOP_FOREGROUND', t)).toBe(
        'no-foreground-job'
      )
      expect(await signalForegroundProcessGroup(100, 'SIGCONT_FOREGROUND', t)).toBe('not-paused')
      expect(t.kill).not.toHaveBeenCalled()
      expect(t.write).not.toHaveBeenCalled()
    }
  )

  it.runIf(posix)('does not type fg when the shell does not own the terminal', async () => {
    const t = terminal(100, 250)
    await signalForegroundProcessGroup(100, 'SIGSTOP_FOREGROUND', {
      ...t,
      readGroup: async () => 250
    })
    await signalForegroundProcessGroup(100, 'SIGCONT_FOREGROUND', {
      ...t,
      readGroup: async () => 250
    })
    expect(t.write).not.toHaveBeenCalled()
  })

  it.runIf(posix)('continues every stopped group on teardown', async () => {
    const a = terminal(100, 250)
    const b = terminal(200, 350)
    await signalForegroundProcessGroup(100, 'SIGSTOP_FOREGROUND', a)
    await signalForegroundProcessGroup(200, 'SIGSTOP_FOREGROUND', b)
    const kill = vi.fn()
    expect(continueAllStoppedGroups(kill)).toBe(2)
    expect(kill.mock.calls).toEqual([
      [-250, 'SIGCONT'],
      [-350, 'SIGCONT']
    ])
  })

  it('rejects ordinary signal names', async () => {
    expect(isForegroundSignal('SIGINT')).toBe(false)
    expect(await signalForegroundProcessGroup(1, 'SIGINT', { write: vi.fn() })).toBe('unsupported')
  })
})
