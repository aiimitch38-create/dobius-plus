import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import { makePaneKey } from '../../shared/stable-pane-id'
import { AgentHookServer } from './server'

const { failures } = vi.hoisted(() => ({
  failures: { write: false, rename: false }
}))

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
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
      if (failures.write && String(file).endsWith('.tmp')) {
        actual.writeFileSync(file, '{"version":2,"ent')
        fail('ENOSPC')
      }
      return (actual.writeFileSync as (...args: unknown[]) => void)(file, ...rest)
    }) as typeof actual.writeFileSync,
    renameSync: ((from: string, to: string) => {
      if (failures.rename && String(from).endsWith('.tmp')) {
        fail('EPERM')
      }
      actual.renameSync(from, to)
    }) as typeof actual.renameSync
  }
  return { ...mocked, default: mocked }
})

const PANE = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
const ELEVEN_MINUTES = 11 * 60_000

let userDataPath = ''

function hooksDir(): string {
  return join(userDataPath, 'agent-hooks')
}

function tmpLeftovers(): string[] {
  return readdirSync(hooksDir()).filter((name) => name.endsWith('.tmp'))
}

async function postPrompt(server: AgentHookServer, prompt: string): Promise<void> {
  const env = server.buildPtyEnv()
  const res = await fetch(`http://127.0.0.1:${env.DOBIUS_AGENT_HOOK_PORT}/hook/claude`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dobius-Agent-Hook-Token': env.DOBIUS_AGENT_HOOK_TOKEN
    },
    body: JSON.stringify({
      paneKey: PANE,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      env: 'production',
      payload: { hook_event_name: 'UserPromptSubmit', prompt }
    })
  })
  await res.text()
}

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'dobius-hook-tmp-'))
  failures.write = false
  failures.rename = false
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  rmSync(userDataPath, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('last-status.json temp-file hygiene (#49)', () => {
  it.each([
    ['a write that fails midway', 'write'],
    ['a rename that fails', 'rename']
  ] as const)('%s keeps the previous file and leaves no temp', async (_label, key) => {
    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      await postPrompt(server, 'first')
      server.flushStatusPersistSync()
      const statusPath = join(hooksDir(), 'last-status.json')
      const before = readFileSync(statusPath, 'utf8')

      failures[key] = true
      await postPrompt(server, 'second')
      server.flushStatusPersistSync()

      expect(readFileSync(statusPath, 'utf8')).toBe(before)
      expect(tmpLeftovers()).toEqual([])
    } finally {
      failures.write = false
      failures.rename = false
      server.stop()
    }
  })

  it("sweeps abandoned temps on start but keeps a live writer's and a young temp", async () => {
    mkdirSync(hooksDir(), { recursive: true })
    const uuid = '0f0e0d0c-0b0a-4908-8706-050403020100'
    const make = (name: string, ageMs: number): void => {
      const file = join(hooksDir(), name)
      writeFileSync(file, '')
      const when = (Date.now() - ageMs) / 1000
      utimesSync(file, when, when)
    }
    const ownOld = `.last-status-${process.pid}-${uuid}.tmp`
    const deadOld = `.last-status-2147483646-${uuid}.tmp`
    const liveOld = `.last-status-${process.ppid}-${uuid}.tmp`
    const young = `.last-status-2147483646-a${uuid.slice(1)}.tmp`
    make(ownOld, ELEVEN_MINUTES)
    make(deadOld, ELEVEN_MINUTES)
    make(liveOld, ELEVEN_MINUTES)
    make(young, 1_000)

    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      expect(tmpLeftovers().sort()).toEqual([liveOld, young].sort())
    } finally {
      server.stop()
    }
  })
})
