import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

type Envelope = {
  eventId: string
  eventType: string
  occurredAt: string
  sourceTool: string
  runId: string
  agentId: string
  context?: Record<string, unknown>
  payload: Record<string, unknown>
  schemaVersion: number
}
const posted: { url: string; body: Envelope }[] = []

async function loadModules() {
  vi.resetModules()
  const actions = await import('./dobius-action-events')
  const journal = await import('./agent-run-event-journal')
  return { ...actions, ...journal }
}

beforeEach(() => {
  electronMock.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-action-events-'))
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
  process.env.ADAM_SERVICE_TOKEN = FAKE_TOKEN
  posted.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      posted.push({ url: String(url), body: JSON.parse(String(init.body)) as Envelope })
      return new Response('{}', { status: 200 })
    })
  )
})

afterEach(() => {
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
})

describe('emitDobiusActionEvent (B3)', () => {
  it('delivers one normalized envelope through the run-event drainer to /v1/events/ingest', async () => {
    const { emitDobiusActionEvent, startAgentRunEventDelivery, whenAgentRunJournalIdle } =
      await loadModules()
    startAgentRunEventDelivery()
    emitDobiusActionEvent({
      type: 'task.status.changed',
      ts: 1_700_000_000_000,
      actor: 'runtime',
      context: { correlationId: 'task-1', projectId: 'project-1' },
      payload: { taskId: 'task-1', status: 'completed' }
    })
    await whenAgentRunJournalIdle()

    expect(posted).toHaveLength(1)
    expect(posted[0].url).toMatch(/\/v1\/events\/ingest$/)
    expect(posted[0].body).toMatchObject({
      eventType: 'task.status.changed',
      occurredAt: '2023-11-14T22:13:20.000Z',
      sourceTool: 'dobius',
      // ADAM's schema requires runId/agentId: the correlation id and actor stand in.
      runId: 'task-1',
      agentId: 'runtime',
      context: { correlationId: 'task-1', projectId: 'project-1' },
      payload: { taskId: 'task-1', status: 'completed' },
      schemaVersion: 1
    })
    expect(posted[0].body.eventId).toMatch(/^[0-9a-f-]{36}$/)
    // Same journal file as the agent.run.* events: one writer, one cursor.
    const journal = readFileSync(path.join(electronMock.userDataDir, 'agent-events.ndjson'), 'utf8')
    expect(journal.trim().split('\n')).toHaveLength(1)
  })

  it('keeps the run id when the action belongs to an agent run', async () => {
    const { emitDobiusActionEvent, startAgentRunEventDelivery, whenAgentRunJournalIdle } =
      await loadModules()
    startAgentRunEventDelivery()
    emitDobiusActionEvent({
      type: 'agent.decision.resolved',
      actor: 'user',
      runId: 'run-9',
      context: { correlationId: 'corr-9' },
      payload: { decisionId: 'd-1', behavior: 'allow' }
    })
    await whenAgentRunJournalIdle()

    expect(posted).toHaveLength(1)
    expect(posted[0].body).toMatchObject({ runId: 'run-9', agentId: 'user' })
    expect(Date.parse(posted[0].body.occurredAt)).not.toBeNaN()
  })

  it('interleaves with agent.run.* events in journal order through the single drainer', async () => {
    const {
      appendAgentRunJournalEvent,
      emitDobiusActionEvent,
      startAgentRunEventDelivery,
      whenAgentRunJournalIdle
    } = await loadModules()
    startAgentRunEventDelivery()
    appendAgentRunJournalEvent({
      runId: 'run-1',
      agentId: 'agent-1',
      ts: 1,
      kind: 'system',
      detail: 'init'
    })
    emitDobiusActionEvent({
      type: 'git.commit.landed',
      actor: 'user',
      context: { correlationId: 'c-1' },
      payload: { worktreePath: '/repo', message: 'x'.repeat(5_000) }
    })
    appendAgentRunJournalEvent({ runId: 'run-1', agentId: 'agent-1', ts: 2, kind: 'result' })
    await whenAgentRunJournalIdle()

    expect(posted.map((call) => call.body.eventType)).toEqual([
      'agent.run.system',
      'git.commit.landed',
      'agent.run.result'
    ])
    // Long string payload fields are truncated like run-event text.
    expect(String(posted[1].body.payload.message)).toHaveLength(4_001)
  })
})
