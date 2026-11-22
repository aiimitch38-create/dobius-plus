// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdamTurnEvent } from '../../../../../shared/speech-types'
import { createVoiceTurnRecorder, currentlyLookingAt } from './adam-voice-thread'
import { appendToBoardThread } from './board-thread-store'

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => store.state } }))

// Stands in for the main process, which owns the thread: adds a row once and tells the window.
type Row = { id: string; role: string; text: string; voice?: boolean; tone?: string }
let mainRows: Row[]
let tell: ((rows: Row[]) => void) | null
function installMain(): void {
  mainRows = []
  tell = null
  ;(window as unknown as { api: unknown }).api = {
    jarvis: {
      adamThreadGet: async () => mainRows,
      adamThreadAppend: async (row: Row) => {
        if (!mainRows.some((existing) => existing.id === row.id)) {
          mainRows = [...mainRows, row]
          tell?.(mainRows)
        }
        return { ok: true }
      },
      adamThreadClear: async () => {
        mainRows = []
        tell?.(mainRows)
        return { ok: true }
      },
      onAdamThread: (callback: (rows: Row[]) => void) => {
        tell = callback
        return () => {
          tell = null
        }
      }
    }
  }
}
const thread = () =>
  mainRows.map(({ role, text, voice, tone }) => ({ role, text, voice, tone }))
const asked = (
  turnId: string,
  text: string,
  source: 'voice' | 'thread' = 'voice'
): AdamTurnEvent => ({ turnId, source, phase: 'asked', text, at: 1 })
const answered = (
  turnId: string,
  text: string,
  source: 'voice' | 'thread' = 'voice'
): AdamTurnEvent => ({
  turnId,
  source,
  phase: 'answered',
  result: { kind: 'answer', text },
  at: 2
})

beforeEach(installMain)

describe('voice turns in ADAM’s thread', () => {
  it('lands a voice turn and a typed turn in the one thread, in order, voice marked', () => {
    const record = createVoiceTurnRecorder()
    record(asked('v1', 'what is running'))
    record(answered('v1', 'Two consoles.'))
    // A typed turn: the thread writes its own rows; its events are not written twice.
    record(asked('t1', '[wrapped prompt]', 'thread'))
    appendToBoardThread({ role: 'user', text: 'and the other project?' })
    record(answered('t1', 'One more there.', 'thread'))
    appendToBoardThread({ role: 'assistant', text: 'One more there.' })
    expect(thread()).toEqual([
      { role: 'user', text: 'what is running', voice: true, tone: undefined },
      { role: 'assistant', text: 'Two consoles.', voice: true, tone: undefined },
      { role: 'user', text: 'and the other project?', voice: undefined, tone: undefined },
      { role: 'assistant', text: 'One more there.', voice: undefined, tone: undefined }
    ])
  })

  it('writes a turn once when two windows hear it', () => {
    const windowA = createVoiceTurnRecorder()
    const windowB = createVoiceTurnRecorder()
    for (const record of [windowA, windowB]) {
      record(asked('v1', 'status?'))
    }
    for (const record of [windowA, windowB]) {
      record(answered('v1', 'All quiet.'))
    }
    expect(thread().map((row) => row.text)).toEqual(['status?', 'All quiet.'])
  })

  it('keeps the reply after a reload: no memory of the question is needed', () => {
    createVoiceTurnRecorder()(asked('v1', 'status?'))
    createVoiceTurnRecorder()(answered('v1', 'All quiet.'))
    expect(thread().map((row) => row.text)).toEqual(['status?', 'All quiet.'])
  })

  it('shows a failed voice turn as a plain error row', () => {
    const record = createVoiceTurnRecorder()
    record(asked('v1', 'hello'))
    record({
      turnId: 'v1',
      source: 'voice',
      phase: 'answered',
      result: { kind: 'error', text: 'ADAM is busy with another message.' },
      at: 2
    })
    expect(thread()[1]).toMatchObject({ role: 'system', tone: 'error', voice: true })
    expect(thread()[1].text).toContain('ADAM is busy with another message.')
  })

})

describe('currentlyLookingAt', () => {
  it('names the project, workspace and folder on screen', () => {
    store.state = {
      activeWorktreeId: 'wt-1',
      repos: [{ id: 'repo-1', displayName: 'Pocket Cologne' }],
      getKnownWorktreeById: (id: string) =>
        id === 'wt-1'
          ? { repoId: 'repo-1', displayName: ' ', branch: 'refs/heads/checkout-fix', path: '/code/pc' }
          : undefined
    }
    expect(currentlyLookingAt()).toEqual({
      project: 'Pocket Cologne',
      workspace: 'checkout-fix',
      folder: '/code/pc'
    })
  })

  it('is unknown when no workspace is open', () => {
    store.state = { activeWorktreeId: null, getKnownWorktreeById: () => undefined }
    expect(currentlyLookingAt()).toBeNull()
  })
})
