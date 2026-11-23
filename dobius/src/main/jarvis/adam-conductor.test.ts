import { describe, expect, it, vi } from 'vitest'
import {
  AdamConductor,
  CONDUCTOR_EXPIRE_MS,
  CONDUCTOR_SETTLE_MS,
  doneNotice,
  firstSentence,
  needsYouNotice,
  setAdamConductor,
  type ConductorNotice,
  type ConductorRead,
  type ConductorStatus
} from './adam-conductor'
import { conductorReadOf, trackedQuickHands } from './adam-conductor-runtime'
import { QuickHandRefused, type QuickHandsDeps } from './live-voice-quick-hands'
import { TERMINAL_METHODS } from '../runtime/rpc/methods/terminal'

type Harness = {
  conductor: AdamConductor
  notices: ConductorNotice[]
  set: (handle: string, status: ConductorStatus['status'], running?: boolean) => void
  reads: Map<string, ConductorRead>
  advance: (ms: number) => Promise<void>
  clock: { now: number }
  enabled: { on: boolean }
}

function harness(): Harness {
  const clock = { now: 1_000_000 }
  const statuses = new Map<string, ConductorStatus>()
  const reads = new Map<string, ConductorRead>()
  const notices: ConductorNotice[] = []
  const enabled = { on: true }
  const conductor = new AdamConductor({
    status: async (handle) => {
      const status = statuses.get(handle)
      if (!status) {
        throw new Error('terminal_gone')
      }
      return status
    },
    read: async (handle) => reads.get(handle) ?? { reply: null, screen: [] },
    labelOf: async (handle) => (handle === 'h1' ? 'Juniper' : 'Backend'),
    report: (notice) => notices.push(notice),
    enabled: () => enabled.on,
    now: () => clock.now,
    setInterval: () => 1,
    clearInterval: () => undefined
  })
  const set = (handle: string, status: ConductorStatus['status'], running = true): void => {
    statuses.set(handle, { isRunningAgent: running, status })
  }
  const advance = async (ms: number): Promise<void> => {
    clock.now += ms
    await conductor.check()
  }
  return { conductor, notices, set, reads, advance, clock, enabled }
}

describe('AdamConductor', () => {
  it('reports one finish after the agent worked and then stayed done', async () => {
    const h = harness()
    h.set('h1', 'idle')
    h.conductor.noteDispatch('h1', 'fix the login bug', 'quick-hands')
    // Idle before Enter is not a finish.
    await h.advance(10_000)
    await h.advance(10_000)
    expect(h.notices).toEqual([])

    h.set('h1', 'working')
    await h.advance(2_000)
    h.set('h1', 'idle')
    h.reads.set('h1', {
      reply: { text: 'I fixed the **login** bug. Tests pass.', at: h.clock.now },
      screen: []
    })
    await h.advance(2_000)
    expect(h.notices).toEqual([])
    await h.advance(CONDUCTOR_SETTLE_MS)
    expect(h.notices.map((n) => [n.kind, n.text])).toEqual([
      ['done', "Juniper says it's done: I fixed the login bug."]
    ])
    expect(h.conductor.isTracking('h1')).toBe(false)
    await h.advance(CONDUCTOR_SETTLE_MS)
    expect(h.notices).toHaveLength(1)
  })

  it('does not report a done that flaps back to working', async () => {
    const h = harness()
    h.set('h1', 'working')
    h.conductor.noteDispatch('h1', 'run the tests', 'cli')
    await h.advance(1_000)
    for (let i = 0; i < 4; i += 1) {
      h.set('h1', 'idle')
      await h.advance(2_000)
      h.set('h1', 'working')
      await h.advance(2_000)
    }
    expect(h.notices).toEqual([])
    expect(h.conductor.isTracking('h1')).toBe(true)
  })

  it('says when the agent needs Carson, keeps tracking, then reports the finish', async () => {
    const h = harness()
    h.set('h1', 'working')
    h.conductor.noteDispatch('h1', 'deploy it', 'cli')
    await h.advance(1_000)
    h.set('h1', 'permission')
    h.reads.set('h1', { reply: null, screen: ['Bash: rm -rf dist', 'Do you want to proceed?', '❯ 1. Yes'] })
    await h.advance(1_000)
    await h.advance(CONDUCTOR_SETTLE_MS)
    await h.advance(CONDUCTOR_SETTLE_MS)
    expect(h.notices.map((n) => n.text)).toEqual(['Juniper needs you: Do you want to proceed?'])
    expect(h.conductor.isTracking('h1')).toBe(true)

    h.set('h1', 'working')
    await h.advance(1_000)
    h.set('h1', 'idle')
    h.reads.set('h1', { reply: { text: 'Deployed.', at: h.clock.now }, screen: [] })
    await h.advance(1_000)
    await h.advance(CONDUCTOR_SETTLE_MS)
    expect(h.notices.map((n) => n.kind)).toEqual(['needs-you', 'done'])
  })

  it('treats a turn that ended on a question as needing Carson', async () => {
    const h = harness()
    h.set('h1', 'working')
    h.conductor.noteDispatch('h1', 'plan the refactor', 'cli')
    await h.advance(1_000)
    h.set('h1', 'idle')
    h.reads.set('h1', {
      reply: { text: 'I drafted two options. Which one should I build?', at: h.clock.now },
      screen: []
    })
    await h.advance(1_000)
    await h.advance(CONDUCTOR_SETTLE_MS)
    await h.advance(CONDUCTOR_SETTLE_MS)
    expect(h.notices.map((n) => [n.kind, n.text])).toEqual([
      ['needs-you', 'Juniper needs you: Which one should I build?']
    ])
  })

  it('says nothing about a terminal ADAM never sent work to', async () => {
    const h = harness()
    h.set('h2', 'working')
    await h.advance(1_000)
    h.set('h2', 'idle')
    await h.advance(CONDUCTOR_SETTLE_MS * 3)
    expect(h.notices).toEqual([])
    expect(h.conductor.size).toBe(0)
  })

  it('never shows a reply that looks like a secret', async () => {
    const h = harness()
    h.set('h1', 'working')
    h.conductor.noteDispatch('h1', 'make a key', 'cli')
    await h.advance(1_000)
    h.set('h1', 'idle')
    h.reads.set('h1', {
      reply: { text: 'Created the key sk-live-abcdef123456 for you.', at: h.clock.now },
      screen: []
    })
    await h.advance(1_000)
    await h.advance(CONDUCTOR_SETTLE_MS)
    expect(h.notices[0]?.text).toBe(
      "Juniper says it's done. Its reply looked like it had a secret, so I left it out."
    )
    expect(h.notices[0]?.text).not.toContain('sk-live')
  })

  it('forgets a closed terminal and one past the expiry', async () => {
    const h = harness()
    h.set('h1', 'idle')
    h.conductor.noteDispatch('h1', 'a', 'cli')
    h.conductor.noteDispatch('h9', 'b', 'cli')
    await h.advance(1_000)
    expect(h.conductor.isTracking('h9')).toBe(false)
    await h.advance(CONDUCTOR_EXPIRE_MS + 1)
    expect(h.conductor.size).toBe(0)
  })

  it('ignores dispatches and drops tracking while the setting is off', async () => {
    const h = harness()
    h.enabled.on = false
    h.conductor.noteDispatch('h1', 'a', 'cli')
    expect(h.conductor.size).toBe(0)
    h.enabled.on = true
    h.conductor.noteDispatch('h1', 'a', 'cli')
    h.enabled.on = false
    await h.advance(1_000)
    expect(h.conductor.size).toBe(0)
  })

  it('hands each notice to ADAM once, as context for his next turn', async () => {
    const h = harness()
    h.set('h1', 'working')
    h.conductor.noteDispatch('h1', 'a', 'cli')
    await h.advance(1_000)
    h.set('h1', 'idle')
    await h.advance(1_000)
    await h.advance(CONDUCTOR_SETTLE_MS)
    expect(h.conductor.takeContext()).toEqual([
      'Juniper looks finished, but I could not read what it said.'
    ])
    expect(h.conductor.takeContext()).toEqual([])
  })

  it('announces once even when a poke lands during the reads', async () => {
    const h = harness()
    h.set('h1', 'working')
    h.conductor.noteDispatch('h1', 'a', 'cli')
    await h.advance(1_000)
    h.set('h1', 'idle')
    await h.advance(1_000)
    h.clock.now += CONDUCTOR_SETTLE_MS
    h.conductor.poke()
    h.conductor.poke()
    await h.conductor.check()
    expect(h.notices).toHaveLength(1)
  })
})

describe('notice wording', () => {
  it('quotes only a reply written after ADAM sent the work', () => {
    const read = { reply: { text: 'Old answer.', at: 10 }, screen: [] }
    expect(doneNotice('Juniper', read, 20)).toBe(
      'Juniper looks finished, but I could not read what it said.'
    )
    expect(doneNotice('Juniper', read, 5)).toBe("Juniper says it's done: Old answer.")
  })

  it('caps the notice at 200 characters', () => {
    const long = `Done ${'word '.repeat(80)}.`
    const notice = doneNotice('Juniper', { reply: { text: long, at: null }, screen: [] }, 0)
    expect(notice.length).toBeLessThanOrEqual(200)
    expect(notice.length).toBeGreaterThan(190)
    expect(notice.endsWith('…')).toBe(true)
  })

  it('falls back to a plain line when no question can be read', () => {
    expect(needsYouNotice('Juniper', null, 'permission', 0)).toBe(
      'Juniper needs you: it is waiting for your answer or a permission.'
    )
  })

  it('takes the first sentence without markdown or escapes', () => {
    expect(firstSentence('\u001b[1m## Fixed\u001b[0m the `login` bug. Next')).toBe(
      'Fixed the login bug.'
    )
  })

  it('reads the last assistant message and the screen from a terminal read', () => {
    const read = conductorReadOf({
      handle: 'h1',
      status: 'running',
      tail: [],
      truncated: false,
      nextCursor: null,
      screen: {
        available: true,
        source: 'headless-emulator',
        cols: 80,
        rows: 24,
        alternateScreen: false,
        scrollback: [],
        screen: ['> '],
        limited: false,
        scrollbackRowsRetained: 0,
        scrollbackCapacity: 0,
        scrollbackMayBeEvicted: false
      },
      transcript: {
        available: true,
        source: 'transcript',
        agent: 'claude',
        sessionId: null,
        path: '/x',
        messages: [
          { role: 'assistant', text: 'first', timestamp: 1, clipped: false, chars: 5 },
          { role: 'assistant', text: 'All done.', timestamp: 2, clipped: false, chars: 9 },
          { role: 'user', text: 'thanks', timestamp: 3, clipped: false, chars: 6 }
        ],
        olderMessagesOmitted: false,
        fileBytes: 0,
        scannedBytes: 0
      }
    } as never)
    expect(read).toEqual({ reply: { text: 'All done.', at: 2 }, screen: ['> '] })
  })
})

describe('dispatch tracking from quick hands', () => {
  const base = (typeInto: QuickHandsDeps['typeInto']): QuickHandsDeps => ({
    listTerminals: async () => ({ terminals: [], truncated: false }),
    typeInto,
    readTail: async () => []
  })

  it('tracks a terminal ADAM typed into, and not one that refused', async () => {
    const h = harness()
    const hands = trackedQuickHands(base(async () => undefined), () => h.conductor)
    await hands.typeInto('h1', 'fix the bug', () => true)
    expect(h.conductor.isTracking('h1')).toBe(true)

    const refusing = trackedQuickHands(
      base(async () => {
        throw new QuickHandRefused('permission prompt')
      }),
      () => h.conductor
    )
    await expect(refusing.typeInto('h2', 'x', () => true)).rejects.toThrow(QuickHandRefused)
    expect(h.conductor.isTracking('h2')).toBe(false)
  })
})

describe('dispatch tracking from the command line', () => {
  it('tracks `dobius terminal send` only when ADAM marked it', async () => {
    const h = harness()
    setAdamConductor(h.conductor)
    try {
      const runtime = {
        getRuntimeId: () => 'r1',
        resolveLeafForHandle: () => null,
        getDriver: () => ({ kind: 'idle' }),
        sendTerminal: vi.fn(async (handle: string) => ({
          handle,
          accepted: true,
          bytesWritten: 4
        }))
      }
      const send = TERMINAL_METHODS.find((method) => method.name === 'terminal.send')!
      const handler = send.handler as (params: unknown, ctx: unknown) => Promise<unknown>
      const call = (params: Record<string, unknown>): Promise<unknown> =>
        handler(send.params!.parse(params), { runtime })
      await call({ terminal: 'h2', text: 'ls', enter: true })
      expect(h.conductor.isTracking('h2')).toBe(false)
      await call({ terminal: 'h1', text: 'run the tests', enter: true, dispatchedBy: 'adam' })
      expect(h.conductor.isTracking('h1')).toBe(true)
    } finally {
      setAdamConductor(null)
    }
  })
})
