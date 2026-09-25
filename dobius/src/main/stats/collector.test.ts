import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import type * as CollectorModule from './collector'

const { state } = vi.hoisted(() => ({
  state: { userData: '', failWrite: false, failRename: false }
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData }
}))

// Why a pass-through mock: a write that fails midway (ENOSPC) or a rename
// that fails cannot be produced reliably on a real disk.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  const fail = (code: string): never => {
    throw Object.assign(new Error(`${code}: injected`), { code })
  }
  const mocked = {
    ...actual,
    writeFileSync: ((file: Parameters<typeof actual.writeFileSync>[0], ...rest: unknown[]) => {
      if (state.failWrite && String(file).endsWith('.tmp')) {
        actual.writeFileSync(file, '{"schemaVersion":1,"ev')
        fail('ENOSPC')
      }
      return (actual.writeFileSync as (...args: unknown[]) => void)(file, ...rest)
    }) as typeof actual.writeFileSync,
    renameSync: ((from: string, to: string) => {
      if (state.failRename) {
        fail('EPERM')
      }
      actual.renameSync(from, to)
    }) as typeof actual.renameSync
  }
  return { ...mocked, default: mocked }
})

const STATS = 'dobius-stats.json'
const ELEVEN_MINUTES = 11 * 60_000

function statsPath(): string {
  return path.join(state.userData, STATS)
}

function tmpLeftovers(): string[] {
  return readdirSync(state.userData).filter((name) => name.endsWith('.tmp'))
}

function makeTemp(name: string, ageMs: number): void {
  const file = path.join(state.userData, name)
  writeFileSync(file, '')
  const when = (Date.now() - ageMs) / 1000
  utimesSync(file, when, when)
}

async function loadCollector(): Promise<typeof CollectorModule> {
  vi.resetModules()
  const mod = await import('./collector')
  mod.initStatsPath()
  return mod
}

beforeEach(() => {
  state.userData = mkdtempSync(path.join(tmpdir(), 'dobius-stats-'))
  state.failWrite = false
  state.failRename = false
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  rmSync(state.userData, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('StatsCollector temp-file hygiene (#49)', () => {
  it.each([
    ['a write that fails midway', 'failWrite'],
    ['a rename that fails', 'failRename']
  ] as const)('%s keeps the previous stats file and leaves no temp', async (_label, key) => {
    const { StatsCollector } = await loadCollector()
    const collector = new StatsCollector()
    collector.record({ type: 'pr_created', at: 1, meta: { prUrl: 'https://x/pr/1' } })
    collector.flush()
    const before = readFileSync(statsPath(), 'utf-8')

    state[key] = true
    collector.record({ type: 'pr_created', at: 2, meta: { prUrl: 'https://x/pr/2' } })
    expect(() => collector.flush()).toThrow()

    expect(readFileSync(statsPath(), 'utf-8')).toBe(before)
    expect(JSON.parse(before).aggregates.totalPRsCreated).toBe(1)
    expect(tmpLeftovers()).toEqual([])
  })

  it("sweeps abandoned stats temps at startup but keeps a live writer's temp", async () => {
    // Old-format residue from this pid and from a dead pid, both past the minimum age.
    const ownOld = `${STATS}.${process.pid}.1700000000000.a1b2c3.tmp`
    const deadOld = `${STATS}.2147483646.0123456789ab.tmp`
    const liveOld = `${STATS}.${process.ppid}.0123456789ab.tmp`
    const young = `${STATS}.${process.pid}.fedcba987654.tmp`
    makeTemp(ownOld, ELEVEN_MINUTES)
    makeTemp(deadOld, ELEVEN_MINUTES)
    makeTemp(liveOld, ELEVEN_MINUTES)
    makeTemp(young, 1_000)
    makeTemp('unrelated.json.1.abc.tmp', ELEVEN_MINUTES)

    const { StatsCollector } = await loadCollector()
    new StatsCollector()

    expect(tmpLeftovers().sort()).toEqual([liveOld, young, 'unrelated.json.1.abc.tmp'].sort())
  })
})

describe('StatsCollector never overwrites an unreadable stats file (BUILD-009C)', () => {
  it.each([
    ['truncated JSON', '{"schemaVersion":1,"events":[{"type":"agent_start","at":1}],"aggre'],
    ['wrong top-level shape', '[1,2,3]'],
    ['events is not a list', '{"schemaVersion":1,"events":{},"aggregates":{}}']
  ])('%s: counts in memory and leaves the file byte-identical', async (_label, bytes) => {
    writeFileSync(statsPath(), bytes, 'utf-8')
    const { StatsCollector } = await loadCollector()
    const collector = new StatsCollector()

    collector.onAgentStart('pty-1', 1_000)
    collector.onAgentStop('pty-1', 2_000)
    collector.flush()

    expect(collector.getSummary().totalAgentsSpawned).toBe(1)
    expect(readFileSync(statsPath(), 'utf-8')).toBe(bytes)
    const names = readdirSync(state.userData)
    expect(names.filter((name) => name.includes('.unreadable-'))).toHaveLength(1)
    expect(tmpLeftovers()).toEqual([])
  })

  it('still merges an older file with defaults and saves it', async () => {
    writeFileSync(
      statsPath(),
      JSON.stringify({ schemaVersion: 1, aggregates: { totalAgentsSpawned: 5 } }),
      'utf-8'
    )
    const { StatsCollector } = await loadCollector()
    const collector = new StatsCollector()

    collector.onAgentStart('pty-1', 1_000)
    collector.flush()

    const saved = JSON.parse(readFileSync(statsPath(), 'utf-8'))
    expect(saved.aggregates.totalAgentsSpawned).toBe(6)
    expect(saved.aggregates.countedPRs).toEqual([])
    expect(saved.events.map((event: { type: string }) => event.type)).toEqual([
      'agent_start',
      'agent_stop'
    ])
  })
})
