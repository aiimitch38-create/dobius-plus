import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunEvent } from '../../shared/agents'

const electronMock = vi.hoisted(() => ({ userDataDir: '', ready: true }))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMock.userDataDir),
    isReady: vi.fn(() => electronMock.ready)
  }
}))

const FAKE_TOKEN = 'test-token-not-real'
const ENV_KEYS = [
  'ADAM_SERVICE_TOKEN',
  'ADAM_SERVICE_TOKEN_PATH',
  'ADAM_SERVICE_URL',
  'DOBIUS_ADAM_TOKEN_PATH',
  'DOBIUS_ADAM_PROJECT_DIR',
  'DOBIUS_DATA_DIR'
]
let savedEnv: Record<string, string | undefined> = {}
let otherDir = ''

type FetchCall = { eventId: string; url: string; authorization: string }
const fetchCalls: FetchCall[] = []
let respond: (eventId: string) => Promise<Response> = async () => new Response('{}', { status: 200 })

function journalFile(): string {
  return path.join(electronMock.userDataDir, 'agent-events.ndjson')
}

function event(n: number): AgentRunEvent {
  return { runId: `run-${n}`, agentId: 'agent-1', ts: 1_700_000_000_000 + n, kind: 'assistant-text', text: `hello ${n}` }
}

function record(id: string): string {
  return JSON.stringify({
    eventId: id,
    eventType: 'agent.run.assistant-text',
    occurredAt: new Date(0).toISOString(),
    sourceTool: 'dobius',
    runId: 'run',
    agentId: 'agent-1',
    payload: { text: 'secret payload text' },
    schemaVersion: 1
  })
}

async function loadJournal() {
  vi.resetModules()
  return import('./agent-run-event-journal')
}

beforeEach(() => {
  electronMock.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-journal-'))
  otherDir = mkdtempSync(path.join(tmpdir(), 'dobius-journal-other-'))
  electronMock.ready = true
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
  process.env.ADAM_SERVICE_TOKEN = FAKE_TOKEN
  fetchCalls.length = 0
  respond = async () => new Response('{}', { status: 200 })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const { eventId } = JSON.parse(String(init.body)) as { eventId: string }
      const authorization = (init.headers as Record<string, string>).authorization
      fetchCalls.push({ eventId, url: String(url), authorization })
      return respond(eventId)
    })
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
  rmSync(electronMock.userDataDir, { recursive: true, force: true })
  rmSync(otherDir, { recursive: true, force: true })
})

describe('agent run event journal delivery', () => {
  it('keeps appending to disk while ADAM hangs (#78)', async () => {
    respond = () => new Promise<Response>(() => {})
    const journal = await loadJournal()
    journal.startAgentRunEventDelivery()
    journal.appendAgentRunJournalEvent(event(1))
    await vi.waitFor(() => expect(fetchCalls).toHaveLength(1))

    journal.appendAgentRunJournalEvent(event(2))
    journal.appendAgentRunJournalEvent(event(3))
    await vi.waitFor(() =>
      expect(readFileSync(journalFile(), 'utf8').trim().split('\n')).toHaveLength(3)
    )
    expect(fetchCalls).toHaveLength(1)
  })

  it('quarantines poison records and still delivers the events after them (#78)', async () => {
    writeFileSync(
      journalFile(),
      [record('a'), '{not json', record('bad'), JSON.stringify({ no: 'id' }), record('b'), ''].join('\n')
    )
    respond = async (id) => new Response('{}', { status: id === 'bad' ? 422 : 200 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const journal = await loadJournal()
    journal.startAgentRunEventDelivery()
    await journal.whenAgentRunJournalIdle()

    expect(fetchCalls.map((call) => call.eventId)).toEqual(['a', 'bad', 'b'])
    const quarantined = readFileSync(
      path.join(electronMock.userDataDir, 'agent-events.quarantine.ndjson'),
      'utf8'
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { reason: string; line: string })
    expect(quarantined.map((entry) => entry.reason)).toEqual([
      'unparseable record',
      'rejected by ADAM',
      'unparseable record'
    ])
    expect(quarantined[0].line).toBe('{not json')
    expect(journal.getAdamEventDeliveryHealth()).toMatchObject({
      state: 'idle',
      deliveredCount: 2,
      quarantinedCount: 3
    })
    const cursor = JSON.parse(
      readFileSync(path.join(electronMock.userDataDir, 'agent-events.cursor.json'), 'utf8')
    ) as { offset: number }
    expect(cursor.offset).toBe(Buffer.byteLength(readFileSync(journalFile())))
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret payload text')
  })

  it('keeps events pending with a visible health state when no token resolves (#79)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    delete process.env.ADAM_SERVICE_TOKEN
    process.env.ADAM_SERVICE_TOKEN_PATH = path.join(otherDir, 'missing-token')
    writeFileSync(journalFile(), `${record('a')}\n${record('b')}\n`)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const journal = await loadJournal()
    journal.startAgentRunEventDelivery()
    await journal.whenAgentRunJournalIdle()

    expect(fetchCalls).toHaveLength(0)
    const health = journal.getAdamEventDeliveryHealth()
    expect(health.state).toBe('no-token')
    expect(health.detail).toBe('token file ENOENT')
    expect(health.nextRetryAt).not.toBeNull()
    expect(warn.mock.calls.flat().join(' ')).toContain('no-token')
    expect(existsSync(path.join(electronMock.userDataDir, 'agent-events.cursor.json'))).toBe(false)

    writeFileSync(process.env.ADAM_SERVICE_TOKEN_PATH, `${FAKE_TOKEN}\n`)
    await vi.advanceTimersByTimeAsync(1_000)
    await journal.whenAgentRunJournalIdle()
    expect(fetchCalls.map((call) => call.eventId)).toEqual(['a', 'b'])
    expect(journal.getAdamEventDeliveryHealth().state).toBe('idle')
    expect(warn.mock.calls.flat().join(' ')).not.toContain(FAKE_TOKEN)
  })

  it('retries during the session and delivers a >1,000 backlog once, resuming by cursor (#80, N5)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const ids = Array.from({ length: 1_500 }, (_, i) => `e${i}`)
    writeFileSync(journalFile(), `${ids.map(record).join('\n')}\n`)
    let offline = true
    respond = async (id) => {
      if (id === 'e700' && offline) {
        throw new TypeError('fetch failed')
      }
      return new Response('{}', { status: 200 })
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const journal = await loadJournal()
    journal.startAgentRunEventDelivery()
    await journal.whenAgentRunJournalIdle()
    expect(journal.getAdamEventDeliveryHealth().state).toBe('offline')
    expect(fetchCalls).toHaveLength(701)

    offline = false
    await vi.advanceTimersByTimeAsync(1_000)
    await journal.whenAgentRunJournalIdle()
    const acked = fetchCalls.map((call) => call.eventId)
    acked.splice(700, 1)
    expect(acked).toEqual(ids)
    expect(journal.getAdamEventDeliveryHealth()).toMatchObject({ state: 'idle', deliveredCount: 1_500 })

    // Restart: the cursor says everything was delivered, so nothing is re-posted.
    fetchCalls.length = 0
    const restarted = await loadJournal()
    restarted.startAgentRunEventDelivery()
    await restarted.whenAgentRunJournalIdle()
    expect(fetchCalls).toHaveLength(0)

    restarted.appendAgentRunJournalEvent(event(1))
    await restarted.whenAgentRunJournalIdle()
    expect(fetchCalls).toHaveLength(1)
  })

  it('warns once for an outage that spans several retry passes (review F1)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    writeFileSync(journalFile(), `${record('a')}\n`)
    let down = true
    respond = async () => {
      if (down) {
        throw new TypeError('fetch failed')
      }
      return new Response('{}', { status: 200 })
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const journal = await loadJournal()
    journal.startAgentRunEventDelivery()
    await journal.whenAgentRunJournalIdle()
    await vi.advanceTimersByTimeAsync(1_000)
    await journal.whenAgentRunJournalIdle()
    await vi.advanceTimersByTimeAsync(2_000)
    await journal.whenAgentRunJournalIdle()
    expect(fetchCalls).toHaveLength(3)
    const paused = () => warn.mock.calls.filter((call) => String(call[0]).includes('paused (offline'))
    expect(paused()).toHaveLength(1)

    // A real delivery re-arms the warning for the next outage.
    down = false
    await vi.advanceTimersByTimeAsync(4_000)
    await journal.whenAgentRunJournalIdle()
    down = true
    journal.appendAgentRunJournalEvent(event(1))
    await journal.whenAgentRunJournalIdle()
    expect(paused()).toHaveLength(2)
  })

  it('terminates a torn last line before appending so the next event is delivered (review F2)', async () => {
    writeFileSync(journalFile(), `${record('a')}\n{"eventId":"torn`)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const journal = await loadJournal()
    journal.startAgentRunEventDelivery()
    await journal.whenAgentRunJournalIdle()
    journal.appendAgentRunJournalEvent(event(1))
    journal.appendAgentRunJournalEvent(event(2))
    await journal.whenAgentRunJournalIdle()

    expect(fetchCalls).toHaveLength(3)
    expect(fetchCalls[0].eventId).toBe('a')
    const quarantined = readFileSync(
      path.join(electronMock.userDataDir, 'agent-events.quarantine.ndjson'),
      'utf8'
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { line: string })
    expect(quarantined.map((entry) => entry.line)).toEqual(['{"eventId":"torn'])
    expect(journal.getAdamEventDeliveryHealth()).toMatchObject({ deliveredCount: 3, quarantinedCount: 1 })
  })

  it('follows a changed Settings endpoint and token without restart (#81)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    delete process.env.ADAM_SERVICE_TOKEN
    process.env.ADAM_SERVICE_TOKEN_PATH = path.join(otherDir, 'token')
    writeFileSync(process.env.ADAM_SERVICE_TOKEN_PATH, `${FAKE_TOKEN}-1\n`)
    const journal = await loadJournal()
    const connection = await import('../adam-connection')
    let endpoint = 'http://adam.one:9000/'
    connection.setAdamEndpointSettingReader(() => endpoint)
    journal.startAgentRunEventDelivery()
    journal.appendAgentRunJournalEvent(event(1))
    await journal.whenAgentRunJournalIdle()

    endpoint = 'http://adam.two:9000'
    writeFileSync(process.env.ADAM_SERVICE_TOKEN_PATH, `${FAKE_TOKEN}-2\n`)
    journal.appendAgentRunJournalEvent(event(2))
    await journal.whenAgentRunJournalIdle()

    expect(fetchCalls.map((call) => [call.url, call.authorization])).toEqual([
      ['http://adam.one:9000/v1/events/ingest', `Bearer ${FAKE_TOKEN}-1`],
      ['http://adam.two:9000/v1/events/ingest', `Bearer ${FAKE_TOKEN}-2`]
    ])
  })

  it('shows a not-installed state, keeps events queued and never crashes when ADAM is missing (#118)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    delete process.env.ADAM_SERVICE_TOKEN
    process.env.DOBIUS_ADAM_PROJECT_DIR = path.join(otherDir, 'no-adam-here')
    writeFileSync(journalFile(), `${record('a')}\n`)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const journal = await loadJournal()
    journal.startAgentRunEventDelivery()
    await journal.whenAgentRunJournalIdle()

    expect(fetchCalls).toHaveLength(0)
    expect(journal.getAdamEventDeliveryHealth()).toMatchObject({
      state: 'not-installed',
      detail: 'ADAM folder not found'
    })
    expect(warn.mock.calls.flat().join(' ')).toContain('not-installed')

    // Installing ADAM later is picked up by the next retry, no restart.
    const tokenDir = path.join(process.env.DOBIUS_ADAM_PROJECT_DIR, 'service', 'data')
    mkdirSync(tokenDir, { recursive: true })
    writeFileSync(path.join(tokenDir, 'service-token'), FAKE_TOKEN)
    await vi.advanceTimersByTimeAsync(1_000)
    await journal.whenAgentRunJournalIdle()
    expect(fetchCalls.map((call) => call.eventId)).toEqual(['a'])
    expect(journal.getAdamEventDeliveryHealth().state).toBe('idle')
    expect(warn.mock.calls.flat().join(' ')).not.toContain(FAKE_TOKEN)
  })

  it('does not deliver before startup starts delivery', async () => {
    const journal = await loadJournal()
    journal.appendAgentRunJournalEvent(event(1))
    await journal.whenAgentRunJournalIdle()
    expect(readFileSync(journalFile(), 'utf8').trim().split('\n')).toHaveLength(1)
    expect(fetchCalls).toHaveLength(0)
  })

  it('writes to one journal directory before and after app ready (N4)', async () => {
    process.env.DOBIUS_DATA_DIR = otherDir
    electronMock.ready = false
    const journal = await loadJournal()
    journal.appendAgentRunJournalEvent(event(1))
    await journal.whenAgentRunJournalIdle()
    electronMock.ready = true
    journal.appendAgentRunJournalEvent(event(2))
    await journal.whenAgentRunJournalIdle()

    expect(readFileSync(journalFile(), 'utf8').trim().split('\n')).toHaveLength(2)
    expect(existsSync(path.join(otherDir, 'agent-events.ndjson'))).toBe(false)
  })

  it('starts delivery only after the store is created at startup (N5)', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const ready = source.indexOf("logStartupMilestone('app-ready')")
    const storeCreated = source.indexOf('store = new Store()', ready)
    const start = source.indexOf('startAgentRunEventDelivery()')

    expect(ready).toBeGreaterThanOrEqual(0)
    expect(storeCreated).toBeGreaterThan(ready)
    expect(start).toBeGreaterThan(storeCreated)
    expect(source).not.toContain('replayRecentAgentRunJournalEvents')
    // #81: delivery reads the live Settings endpoint, wired before it starts.
    const reader = source.indexOf('setAdamEndpointSettingReader(() => store?.getSettings().voice?.adamEndpoint)')
    expect(reader).toBeGreaterThan(storeCreated)
    expect(reader).toBeLessThan(start)
  })
})
