import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VertexTask, VertexTaskListFilter } from '../../shared/vertex-task-types'
import {
  LEAD_SPAWN_GRACE_MS,
  LeadWatcher,
  buildNudgeText,
  classifyAgentStatus,
  type LeadConsoleProbe
} from './lead-watcher'

const IDLE: LeadConsoleProbe = { handle: 'terminal:lead', agent: 'idle' }
const BUSY: LeadConsoleProbe = { handle: 'terminal:lead', agent: 'busy' }
const SHELL: LeadConsoleProbe = { handle: 'terminal:lead', agent: 'shell' }

const PROFILE = 'lead-demo'
const PROJECT = 'demo'

type Card = Pick<VertexTask, 'id' | 'status' | 'projectId'> & {
  assignee?: { id: string }
}

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    status: 'todo',
    projectId: PROJECT,
    assignee: { id: PROFILE },
    ...overrides
  }
}

function fakeStore(cards: Card[]) {
  const comments: Array<{ id: string; author: string; body: string }> = []
  return {
    cards,
    comments,
    listFiltered(filter: VertexTaskListFilter): VertexTask[] {
      return cards.filter(
        (c) =>
          (!filter.status || c.status === filter.status) &&
          (!filter.assigneeId || c.assignee?.id === filter.assigneeId) &&
          (!filter.projectId || c.projectId === filter.projectId)
      ) as unknown as VertexTask[]
    },
    comment(id: string, author: string, body: string): VertexTask | null {
      comments.push({ id, author, body })
      return null
    }
  }
}

let home: string
let now: number

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lead-watcher-'))
  now = 1_700_000_000_000
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function build(store: ReturnType<typeof fakeStore>, list: LeadConsoleProbe[] = []) {
  const consoles = { list }
  const spawn = vi.fn(async () => ({ delivered: true }))
  const send = vi.fn(async () => {})
  const logs: string[] = []
  const watcher = new LeadWatcher({
    profile: PROFILE,
    projectId: PROJECT,
    store,
    listLeadConsoles: async () => consoles.list,
    spawnLeadConsole: spawn,
    sendText: send,
    homeDir: home,
    now: () => now,
    log: (message) => {
      logs.push(message)
    }
  })
  return { watcher, spawn, send, consoles, logs }
}

describe('LeadWatcher', () => {
  it('one new todo card: spawns the console once, then nudges once when it exists', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, spawn, send, consoles } = build(store)

    const first = await watcher.poll()
    expect(first).toMatchObject({ readyIds: ['c1'], spawned: true, nudged: false })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()

    // Console not up yet on the next poll: no second spawn, still no nudge.
    now += 30_000
    const second = await watcher.poll()
    expect(second).toMatchObject({ readyIds: ['c1'], spawned: false, nudged: false })
    expect(spawn).toHaveBeenCalledTimes(1)

    consoles.list = [IDLE]
    now += 30_000
    const third = await watcher.poll()
    expect(third).toMatchObject({ readyIds: ['c1'], spawned: false, nudged: true })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('terminal:lead', 'Cards ready: c1. Run the Card Loop.')

    // Repeated polls do not re-nudge.
    now += 30_000
    const fourth = await watcher.poll()
    expect(fourth).toMatchObject({ readyIds: [], spawned: false, nudged: false })
    expect(send).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('a later card produces a second nudge, not a second console', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, spawn, send } = build(store, [IDLE])

    await watcher.poll()
    expect(spawn).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)

    store.cards.push(card('c2'))
    now += 30_000
    const result = await watcher.poll()
    expect(result).toMatchObject({ readyIds: ['c2'], nudged: true, spawned: false })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith('terminal:lead', 'Cards ready: c2. Run the Card Loop.')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('bare shell: never types the nudge, asks the spawn path to replace the card, keeps ids unseen', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, spawn, send, consoles } = build(store, [SHELL])

    const first = await watcher.poll()
    expect(first).toMatchObject({ readyIds: ['c1'], spawned: true, nudged: false, deferred: false })
    expect(send).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledTimes(1)

    // Replacement console comes up idle: the same ids are nudged exactly once.
    consoles.list = [IDLE]
    now += 30_000
    const second = await watcher.poll()
    expect(second).toMatchObject({ readyIds: ['c1'], nudged: true, spawned: false })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('terminal:lead', 'Cards ready: c1. Run the Card Loop.')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('busy agent: defers the nudge with ids unseen, no spawn, then nudges once when idle', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, spawn, send, consoles } = build(store, [BUSY])

    const first = await watcher.poll()
    expect(first).toMatchObject({ readyIds: ['c1'], spawned: false, nudged: false, deferred: true })
    expect(send).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()

    now += 30_000
    const second = await watcher.poll()
    expect(second).toMatchObject({ readyIds: ['c1'], deferred: true, nudged: false })
    expect(send).not.toHaveBeenCalled()

    consoles.list = [IDLE]
    now += 30_000
    const third = await watcher.poll()
    expect(third).toMatchObject({ readyIds: ['c1'], nudged: true, deferred: false })
    expect(send).toHaveBeenCalledTimes(1)

    now += 30_000
    expect((await watcher.poll()).readyIds).toEqual([])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('prefers an idle lead console over a busy one when both exist', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, send } = build(store, [
      { handle: 'terminal:busy', agent: 'busy' },
      { handle: 'terminal:idle', agent: 'idle' }
    ])
    await watcher.poll()
    expect(send).toHaveBeenCalledWith('terminal:idle', 'Cards ready: c1. Run the Card Loop.')
  })

  it('batches several unseen cards into one nudge and persists them to seen.json', async () => {
    const store = fakeStore([card('a'), card('b')])
    const { watcher, send } = build(store, [IDLE])
    await watcher.poll()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('terminal:lead', buildNudgeText(['a', 'b']))

    const seenPath = join(home, '.dobius', 'leads', 'demo', 'seen.json')
    expect(existsSync(seenPath)).toBe(true)
    expect(JSON.parse(readFileSync(seenPath, 'utf8')).seen).toEqual(['a', 'b'])

    // A fresh watcher (e.g. after restart) reads seen.json and stays quiet.
    const again = build(store, [IDLE])
    await again.watcher.poll()
    expect(again.send).not.toHaveBeenCalled()
  })

  it('ignores cards for other assignees, projects or statuses', async () => {
    const store = fakeStore([
      card('other-assignee', { assignee: { id: 'lead-x' } }),
      card('other-project', { projectId: 'x' }),
      card('backlog', { status: 'backlog' })
    ])
    const { watcher, spawn, send } = build(store)
    const result = await watcher.poll()
    expect(result.readyIds).toEqual([])
    expect(spawn).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps ids unseen when the nudge fails, so the next poll retries', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, send } = build(store, [IDLE])
    send.mockRejectedValueOnce(new Error('terminal_not_writable'))
    await expect(watcher.poll()).rejects.toThrow('terminal_not_writable')
    const second = await watcher.poll()
    expect(second.nudged).toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('tick never throws and records the last error', async () => {
    const store = fakeStore([card('c1')])
    store.listFiltered = () => {
      throw new Error('board unreadable')
    }
    const { watcher } = build(store)
    await expect(watcher.tick()).resolves.toBeNull()
    expect(watcher.status().lastError).toBe('board unreadable')
  })

  it('asks for the console again after the spawn grace period', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, spawn } = build(store)
    await watcher.poll()
    now += LEAD_SPAWN_GRACE_MS + 1
    await watcher.poll()
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('retries an undelivered spawn on the next poll instead of waiting out the grace period', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, spawn } = build(store)
    spawn.mockResolvedValueOnce({ delivered: false })

    const first = await watcher.poll()
    expect(first).toMatchObject({ readyIds: ['c1'], spawned: false, nudged: false })
    expect(spawn).toHaveBeenCalledTimes(1)

    now += 30_000
    const second = await watcher.poll()
    expect(second.spawned).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(2)

    // Delivered: the grace period is armed, so the third poll does not ask again.
    now += 30_000
    await watcher.poll()
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('treats a corrupt seen.json as empty and logs it', async () => {
    const dir = join(home, '.dobius', 'leads', PROJECT)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'seen.json'), '{not json')
    const store = fakeStore([card('c1')])
    const { watcher, send, logs } = build(store, [IDLE])
    expect(logs.some((m) => m.includes('ignoring unreadable'))).toBe(true)
    await watcher.poll()
    expect(send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(join(dir, 'seen.json'), 'utf8')).seen).toEqual(['c1'])
  })

  it('start/stop drive the timer and status reports it', async () => {
    vi.useFakeTimers()
    try {
      const store = fakeStore([card('c1')])
      const { watcher, send } = build(store, [IDLE])
      watcher.start()
      expect(watcher.status().running).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(send).toHaveBeenCalledTimes(1)
      store.cards.push(card('c2'))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(send).toHaveBeenCalledTimes(2)
      watcher.stop()
      expect(watcher.status().running).toBe(false)
      store.cards.push(card('c3'))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(send).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('LeadWatcher launch backoff', () => {
  it('three launches that end at a shell halt spawning, set the status error and comment each card once', async () => {
    const store = fakeStore([card('c1'), card('c2')])
    const { watcher, spawn, send, consoles } = build(store)

    // Launch 1 (no card yet), then it lands at a shell: failure 1, replaced at once.
    expect((await watcher.poll()).spawned).toBe(true)
    consoles.list = [SHELL]
    now += 30_000
    expect(await watcher.poll()).toMatchObject({ spawned: true, halted: false })
    expect(watcher.status().launchFailures).toBe(1)

    // Launch 2 lands at a shell: failure 2, replaced again.
    now += 30_000
    expect(await watcher.poll()).toMatchObject({ spawned: true, halted: false })
    expect(watcher.status().launchFailures).toBe(2)

    // Launch 3 lands at a shell: halt. No fourth spawn, one comment per waiting card.
    now += 30_000
    const halt = await watcher.poll()
    expect(halt).toMatchObject({
      spawned: false,
      nudged: false,
      halted: true,
      commentedIds: ['c1', 'c2']
    })
    expect(spawn).toHaveBeenCalledTimes(3)
    expect(send).not.toHaveBeenCalled()
    expect(watcher.status()).toMatchObject({
      halted: true,
      launchFailures: 3,
      lastError:
        'lead console keeps exiting — check the Hermes profile lead-demo (hermes -p lead-demo chat)'
    })
    expect(store.comments).toHaveLength(2)
    expect(store.comments[0]).toMatchObject({ id: 'c1', author: 'dobius-lead-watcher' })
    expect(store.comments[0].body).toContain('could not start')
    expect(store.comments[0].body).toContain('hermes -p lead-demo chat')

    // Later polls (even past the grace period): still halted, no spawn, no new comments.
    now += LEAD_SPAWN_GRACE_MS + 1
    expect(await watcher.poll()).toMatchObject({ spawned: false, halted: true, commentedIds: [] })
    now += 30_000
    expect(await watcher.poll()).toMatchObject({ spawned: false, halted: true, commentedIds: [] })
    expect(spawn).toHaveBeenCalledTimes(3)
    expect(store.comments).toHaveLength(2)
    // tick() does not wipe the halt message.
    await watcher.tick()
    expect(watcher.status().lastError).toContain('keeps exiting')

    // A new card while halted gets its one comment too, and nothing else.
    store.cards.push(card('c3'))
    now += 30_000
    expect(await watcher.poll()).toMatchObject({ halted: true, commentedIds: ['c3'] })
    expect(store.comments).toHaveLength(3)

    // Halt comments survive a watcher restart (seen.json), so no duplicates.
    const again = build(store, [SHELL])
    await again.watcher.poll()
    expect(store.comments).toHaveLength(3)
  })

  it('a launch that never becomes an agent within the grace period counts as a failure', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, spawn } = build(store)
    await watcher.poll()
    expect(watcher.status().launchFailures).toBe(0)
    now += LEAD_SPAWN_GRACE_MS
    await watcher.poll()
    expect(watcher.status().launchFailures).toBe(1)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('a running agent resets the failure count', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, send, consoles } = build(store)
    await watcher.poll()
    consoles.list = [SHELL]
    now += 30_000
    await watcher.poll()
    now += 30_000
    await watcher.poll()
    expect(watcher.status().launchFailures).toBe(2)

    consoles.list = [IDLE]
    now += 30_000
    expect((await watcher.poll()).nudged).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(watcher.status()).toMatchObject({ launchFailures: 0, halted: false, lastError: null })
  })

  it('resetLaunchFailures (lead start again) clears the halt and spawns once more', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, spawn, consoles } = build(store)
    await watcher.poll()
    consoles.list = [SHELL]
    for (let i = 0; i < 3; i += 1) {
      now += 30_000
      await watcher.poll()
    }
    expect(watcher.status().halted).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(3)

    watcher.resetLaunchFailures()
    expect(watcher.status()).toMatchObject({ halted: false, launchFailures: 0, lastError: null })
    now += 30_000
    expect(await watcher.poll()).toMatchObject({ spawned: true, halted: false })
    expect(spawn).toHaveBeenCalledTimes(4)
  })

  it('a pre-existing shell card with no launch of ours is replaced without counting a failure', async () => {
    const store = fakeStore([card('c1')])
    const { watcher, spawn } = build(store, [SHELL])
    expect(await watcher.poll()).toMatchObject({ spawned: true, halted: false })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(watcher.status().launchFailures).toBe(0)
  })
})

describe('classifyAgentStatus', () => {
  it('mirrors the Board delivery gate: shell skips, working/permission wait, idle sends', () => {
    expect(classifyAgentStatus({ isRunningAgent: false, status: null })).toBe('shell')
    expect(classifyAgentStatus({ isRunningAgent: false, status: 'idle' })).toBe('shell')
    expect(classifyAgentStatus({ isRunningAgent: true, status: 'working' })).toBe('busy')
    expect(classifyAgentStatus({ isRunningAgent: true, status: 'permission' })).toBe('busy')
    expect(classifyAgentStatus({ isRunningAgent: true, status: 'idle' })).toBe('idle')
    expect(classifyAgentStatus({ isRunningAgent: true, status: null })).toBe('idle')
  })
})
