import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  continueAllStoppedGroups,
  continueStoppedGroupForShell,
  isForegroundSignal,
  isGroupStoppedForShell,
  resetStoppedGroupsForTest,
  signalForegroundProcessGroup,
  type JobState
} from './foreground-process-group'

const posix = process.platform !== 'win32'
// Ctrl-C, then `fg`: drops whatever is on the prompt line first.
const FG = '\x03fg\r'

// Models a real terminal with job control, as an interactive zsh behaves:
// - stopping the foreground job hands the terminal to the shell;
// - a job continued while it does not own the terminal runs in the BACKGROUND,
//   and a full-screen agent there is stopped again by the kernel;
// - only the shell's own `fg` gives the job the terminal and continues it.
// `ptyPid` is what the pty reports. On macOS that is `login`, not the shell.
function terminal(opts: { ptyPid: number; shellPid: number; jobPgid: number }) {
  const { ptyPid, shellPid, jobPgid } = opts
  let foreground = jobPgid
  let state: JobState = 'running'
  /** What typing `fg` at the prompt does: 'job' | 'nothing' | another group id. */
  let fgEffect: 'job' | 'nothing' | number = 'job'
  let onReadState: (() => void) | null = null
  const kill = vi.fn((pid: number, sig: string) => {
    if (pid !== -jobPgid) {
      return
    }
    if (state === 'gone') {
      throw new Error('ESRCH')
    }
    if (sig === 'SIGSTOP') {
      state = 'stopped'
      if (foreground === jobPgid) {
        foreground = shellPid
      }
    } else if (sig === 'SIGCONT') {
      // Continued in the background: it touches the terminal and stops again.
      state = foreground === jobPgid ? 'running' : 'stopped'
    }
  })
  const userFg = (): void => {
    foreground = jobPgid
    state = 'running'
  }
  const write = vi.fn((data: string) => {
    if (data !== FG || foreground !== shellPid) {
      return
    }
    if (fgEffect === 'job') {
      userFg()
    } else if (fgEffect !== 'nothing') {
      foreground = fgEffect
    }
  })
  return {
    ptyPid,
    deps: {
      kill,
      write,
      readGroup: async () => foreground,
      readJobState: async () => {
        onReadState?.()
        return state
      },
      handoffTimeoutMs: 40,
      handoffPollMs: 5
    },
    kill,
    write,
    foreground: () => foreground,
    state: () => state,
    userFg,
    set: (next: {
      fgEffect?: typeof fgEffect
      state?: JobState
      foreground?: number
      onReadState?: typeof onReadState
    }) => {
      fgEffect = next.fgEffect ?? fgEffect
      state = next.state ?? state
      foreground = next.foreground ?? foreground
      onReadState = next.onReadState === undefined ? onReadState : next.onReadState
    }
  }
}

type Terminal = ReturnType<typeof terminal>
const pause = (t: Terminal) => signalForegroundProcessGroup(t.ptyPid, 'SIGSTOP_FOREGROUND', t.deps)
const resume = (t: Terminal) => signalForegroundProcessGroup(t.ptyPid, 'SIGCONT_FOREGROUND', t.deps)
const wrapped = () => terminal({ ptyPid: 90, shellPid: 100, jobPgid: 250 })

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
    expect(t.state()).toBe('running')
  })

  // The macOS bug: the pty child is `login`, so its pid never equals the
  // shell's group and resume never typed `fg`, leaving the agent frozen.
  it.runIf(posix)('resumes when the pty child is a wrapper around the shell', async () => {
    const t = wrapped()
    expect(await pause(t)).toBe('signalled')
    expect(await resume(t)).toBe('signalled')
    expect(t.write).toHaveBeenCalledWith(FG)
    expect(t.foreground()).toBe(250)
    expect(t.state()).toBe('running')
  })

  it.runIf(posix)('never wakes the agent in the background ahead of the shell', async () => {
    const t = wrapped()
    await pause(t)
    await resume(t)
    expect(t.kill).not.toHaveBeenCalledWith(-250, 'SIGCONT')
  })

  it.runIf(posix)('retries a failed resume while the agent is still stopped', async () => {
    const t = wrapped()
    t.set({ fgEffect: 'nothing' })
    await pause(t)
    expect(await resume(t)).toBe('handoff-failed')
    expect(isGroupStoppedForShell(90)).toBe(true)
    t.set({ fgEffect: 'job' })
    expect(await resume(t)).toBe('signalled')
    expect(t.write).toHaveBeenCalledTimes(2)
    expect(t.foreground()).toBe(250)
    expect(isGroupStoppedForShell(90)).toBe(false)
  })

  it.runIf(posix)('does not type fg again while the first one may still be queued', async () => {
    const t = wrapped()
    t.set({ fgEffect: 'nothing' })
    await pause(t)
    expect(await resume(t)).toBe('handoff-failed')
    // The agent is no longer stopped, so the first `fg` is not known to be used up.
    t.set({ state: 'running' })
    expect(await resume(t)).toBe('handoff-failed')
    expect(t.write).toHaveBeenCalledTimes(1)
  })

  it.runIf(posix)('types nothing when the user foregrounds the agent first', async () => {
    const t = wrapped()
    await pause(t)
    // The user runs `fg` by hand while resume is still looking things up.
    t.set({ onReadState: () => t.userFg() })
    expect(await resume(t)).toBe('signalled')
    expect(t.write).not.toHaveBeenCalled()
    expect(isGroupStoppedForShell(90)).toBe(false)
  })

  it.runIf(posix)('types fg once when two resumes overlap', async () => {
    const t = wrapped()
    await pause(t)
    expect(await Promise.all([resume(t), resume(t)])).toEqual(['signalled', 'not-paused'])
    expect(t.write).toHaveBeenCalledTimes(1)
  })

  it.runIf(posix)('runs overlapping pauses one at a time and never stops the shell', async () => {
    const t = wrapped()
    expect(await Promise.all([pause(t), pause(t)])).toEqual(['signalled', 'signalled'])
    expect(t.kill.mock.calls).toEqual([[-250, 'SIGSTOP']])
  })

  it.runIf(posix)('a resume sent right behind a pause waits for it', async () => {
    const t = wrapped()
    expect(await Promise.all([pause(t), resume(t)])).toEqual(['signalled', 'signalled'])
    expect(t.foreground()).toBe(250)
  })

  it.runIf(posix)('refuses a bare prompt, and resume without a pause does nothing', async () => {
    const t = terminal({ ptyPid: 100, shellPid: 100, jobPgid: 100 })
    expect(await pause(t)).toBe('no-foreground-job')
    expect(await resume(t)).toBe('not-paused')
    expect(t.kill).not.toHaveBeenCalled()
    expect(t.write).not.toHaveBeenCalled()
  })

  it.runIf(posix)('tracks a group from the moment it is stopped, and un-freezes it', async () => {
    // A bare prompt behind a wrapper looks like a job; nobody reclaims the terminal.
    const kill = vi.fn()
    const deps = {
      kill,
      write: vi.fn(),
      readGroup: async () => 100,
      readJobState: async (): Promise<JobState> => 'stopped',
      handoffTimeoutMs: 30,
      handoffPollMs: 5
    }
    const pausing = signalForegroundProcessGroup(90, 'SIGSTOP_FOREGROUND', deps)
    await new Promise((resolve) => setTimeout(resolve, 10))
    // Quit cleanup must already know about it while the pause is still deciding.
    expect(isGroupStoppedForShell(90)).toBe(true)
    expect(await pausing).toBe('no-foreground-job')
    expect(kill.mock.calls).toEqual([
      [-100, 'SIGSTOP'],
      [-100, 'SIGCONT']
    ])
    expect(isGroupStoppedForShell(90)).toBe(false)
  })

  it.runIf(posix)('keeps the record when another job owns the terminal', async () => {
    const t = wrapped()
    await pause(t)
    t.set({ foreground: 777 })
    // Continued in the background, the agent stops again: still paused, still tracked.
    expect(await resume(t)).toBe('handoff-failed')
    expect(t.kill).toHaveBeenLastCalledWith(-250, 'SIGCONT')
    expect(t.write).not.toHaveBeenCalled()
    expect(isGroupStoppedForShell(90)).toBe(true)
    t.set({ foreground: 100 })
    expect(await resume(t)).toBe('signalled')
    expect(t.foreground()).toBe(250)
  })

  it.runIf(posix)('reports failure when fg brings a different job forward', async () => {
    const t = wrapped()
    t.set({ fgEffect: 777 })
    await pause(t)
    expect(await resume(t)).toBe('handoff-failed')
    expect(isGroupStoppedForShell(90)).toBe(true)
  })

  it.runIf(posix)('never types fg for an agent that has died', async () => {
    const t = wrapped()
    await pause(t)
    t.set({ state: 'gone' })
    expect(await resume(t)).toBe('no-foreground-job')
    expect(t.write).not.toHaveBeenCalled()
    expect(isGroupStoppedForShell(90)).toBe(false)
  })

  it.runIf(posix)('pauses a new agent after the recorded one died', async () => {
    const t = wrapped()
    await pause(t)
    const next = terminal({ ptyPid: 90, shellPid: 100, jobPgid: 400 })
    const deps = {
      ...next.deps,
      readJobState: async (pgid: number): Promise<JobState> => (pgid === 250 ? 'gone' : 'running')
    }
    expect(await signalForegroundProcessGroup(90, 'SIGSTOP_FOREGROUND', deps)).toBe('signalled')
    expect(next.kill).toHaveBeenCalledWith(-400, 'SIGSTOP')
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

  it.runIf(posix)(
    'continueStoppedGroupForShell resumes only that terminal, leaving others stopped',
    async () => {
      const a = terminal({ ptyPid: 100, shellPid: 100, jobPgid: 250 })
      const b = terminal({ ptyPid: 190, shellPid: 200, jobPgid: 350 })
      await pause(a)
      await pause(b)
      const kill = vi.fn()
      expect(continueStoppedGroupForShell(100, kill)).toBe(true)
      expect(kill).toHaveBeenCalledWith(-250, 'SIGCONT')
      expect(isGroupStoppedForShell(100)).toBe(false)
      expect(isGroupStoppedForShell(190)).toBe(true)
    }
  )

  it('continueStoppedGroupForShell is a no-op for a terminal that was never paused', () => {
    const kill = vi.fn()
    expect(continueStoppedGroupForShell(999, kill)).toBe(false)
    expect(kill).not.toHaveBeenCalled()
  })

  it('rejects ordinary signal names', async () => {
    expect(isForegroundSignal('SIGINT')).toBe(false)
    expect(await signalForegroundProcessGroup(1, 'SIGINT', { write: vi.fn() })).toBe('unsupported')
  })
})
