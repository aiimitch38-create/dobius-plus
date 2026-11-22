import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  continueAllStoppedGroups,
  isForegroundSignal,
  isGroupStoppedForShell,
  resetStoppedGroupsForTest,
  signalForegroundProcessGroup
} from './foreground-process-group'

const posix = process.platform !== 'win32'
const FG = '\x15fg\r'

// Models a real terminal with job control, as an interactive zsh behaves:
// - stopping the foreground job hands the terminal to the shell;
// - a job continued while the shell owns the terminal runs in the BACKGROUND,
//   and a full-screen agent there is stopped again by the kernel;
// - only the shell's own `fg` gives the job the terminal and continues it.
// `ptyPid` is what the pty reports. On macOS that is `login`, not the shell.
function terminal(opts: { ptyPid: number; shellPid: number; jobPgid: number; fgWorks?: boolean }) {
  const { ptyPid, shellPid, jobPgid } = opts
  let fgWorks = opts.fgWorks ?? true
  let foreground = jobPgid
  let jobStopped = false
  const kill = vi.fn((pid: number, sig: string) => {
    if (pid === -shellPid && sig === 'SIGSTOP') {
      throw new Error('the shell itself must never be stopped')
    }
    if (pid !== -jobPgid) {
      return
    }
    if (sig === 'SIGSTOP') {
      jobStopped = true
      foreground = shellPid
    } else if (sig === 'SIGCONT') {
      // Continued in the background: it touches the terminal and stops again.
      jobStopped = foreground !== jobPgid
    }
  })
  const write = vi.fn((data: string) => {
    if (data === FG && foreground === shellPid && fgWorks) {
      foreground = jobPgid
      jobStopped = false
    }
  })
  return {
    ptyPid,
    deps: {
      kill,
      write,
      readGroup: async () => foreground,
      handoffTimeoutMs: 40,
      handoffPollMs: 5
    },
    kill,
    write,
    foreground: () => foreground,
    jobStopped: () => jobStopped,
    setFgWorks: (works: boolean) => {
      fgWorks = works
    }
  }
}

const pause = (t: ReturnType<typeof terminal>) =>
  signalForegroundProcessGroup(t.ptyPid, 'SIGSTOP_FOREGROUND', t.deps)
const resume = (t: ReturnType<typeof terminal>) =>
  signalForegroundProcessGroup(t.ptyPid, 'SIGCONT_FOREGROUND', t.deps)

describe('signalForegroundProcessGroup', () => {
  beforeEach(() => resetStoppedGroupsForTest())

  it.runIf(posix)('stops the agent job, then resumes it back in the foreground', async () => {
    const t = terminal({ ptyPid: 100, shellPid: 100, jobPgid: 250 })
    expect(await pause(t)).toBe('signalled')
    expect(t.kill).toHaveBeenCalledWith(-250, 'SIGSTOP')
    expect(t.foreground()).toBe(100)
    expect(await resume(t)).toBe('signalled')
    expect(t.write).toHaveBeenCalledWith(FG)
    expect(t.foreground()).toBe(250)
    expect(t.jobStopped()).toBe(false)
  })

  // The macOS bug: the pty child is `login`, so its pid never equals the
  // shell's group and resume never typed `fg`, leaving the agent frozen.
  it.runIf(posix)('resumes when the pty child is a wrapper around the shell', async () => {
    const t = terminal({ ptyPid: 90, shellPid: 100, jobPgid: 250 })
    expect(await pause(t)).toBe('signalled')
    expect(await resume(t)).toBe('signalled')
    expect(t.write).toHaveBeenCalledWith(FG)
    expect(t.foreground()).toBe(250)
    expect(t.jobStopped()).toBe(false)
  })

  it.runIf(posix)('never wakes the agent in the background ahead of the shell', async () => {
    const t = terminal({ ptyPid: 90, shellPid: 100, jobPgid: 250 })
    await pause(t)
    await resume(t)
    expect(t.kill).not.toHaveBeenCalledWith(-250, 'SIGCONT')
  })

  it.runIf(posix)('keeps a failed resume retryable', async () => {
    const t = terminal({ ptyPid: 90, shellPid: 100, jobPgid: 250, fgWorks: false })
    await pause(t)
    expect(await resume(t)).toBe('handoff-failed')
    expect(isGroupStoppedForShell(90)).toBe(true)
    t.setFgWorks(true)
    expect(await resume(t)).toBe('signalled')
    expect(t.foreground()).toBe(250)
    expect(isGroupStoppedForShell(90)).toBe(false)
  })

  it.runIf(posix)('types fg once when two resumes overlap', async () => {
    const t = terminal({ ptyPid: 90, shellPid: 100, jobPgid: 250 })
    await pause(t)
    expect(await Promise.all([resume(t), resume(t)])).toEqual(['signalled', 'signalled'])
    expect(t.write).toHaveBeenCalledTimes(1)
  })

  it.runIf(posix)('a second pause never stops the shell', async () => {
    const t = terminal({ ptyPid: 90, shellPid: 100, jobPgid: 250 })
    await pause(t)
    expect(await pause(t)).toBe('signalled')
    expect(t.kill).toHaveBeenCalledTimes(1)
  })

  it.runIf(posix)('refuses a bare prompt, and resume without a pause does nothing', async () => {
    const t = terminal({ ptyPid: 100, shellPid: 100, jobPgid: 100 })
    expect(await pause(t)).toBe('no-foreground-job')
    expect(await resume(t)).toBe('not-paused')
    expect(t.kill).not.toHaveBeenCalled()
    expect(t.write).not.toHaveBeenCalled()
  })

  it.runIf(posix)('un-freezes a group nothing takes the terminal back from', async () => {
    // A bare prompt behind a wrapper looks like a job; nobody reclaims the terminal.
    const kill = vi.fn()
    const write = vi.fn()
    const deps = { kill, write, readGroup: async () => 100, handoffTimeoutMs: 20, handoffPollMs: 5 }
    expect(await signalForegroundProcessGroup(90, 'SIGSTOP_FOREGROUND', deps)).toBe(
      'no-foreground-job'
    )
    expect(kill.mock.calls).toEqual([
      [-100, 'SIGSTOP'],
      [-100, 'SIGCONT']
    ])
    expect(isGroupStoppedForShell(90)).toBe(false)
  })

  it.runIf(posix)('continues without fg when something else owns the terminal', async () => {
    const t = terminal({ ptyPid: 90, shellPid: 100, jobPgid: 250 })
    await pause(t)
    expect(
      await signalForegroundProcessGroup(90, 'SIGCONT_FOREGROUND', {
        ...t.deps,
        readGroup: async () => 777
      })
    ).toBe('signalled')
    expect(t.kill).toHaveBeenLastCalledWith(-250, 'SIGCONT')
    expect(t.write).not.toHaveBeenCalled()
  })

  it.runIf(posix)('continues every stopped group on teardown', async () => {
    const a = terminal({ ptyPid: 100, shellPid: 100, jobPgid: 250 })
    const b = terminal({ ptyPid: 190, shellPid: 200, jobPgid: 350 })
    await pause(a)
    await pause(b)
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
