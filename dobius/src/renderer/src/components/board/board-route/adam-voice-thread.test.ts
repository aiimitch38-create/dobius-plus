// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdamTurnEvent } from '../../../../../shared/speech-types'
import { createVoiceTurnRecorder } from './adam-voice-thread'
import { boardThreadStorageKey, deserializeBoardThread } from './board-thread-persistence'
import { appendToBoardThread, onBoardThreadAppend } from './board-thread-store'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))

const thread = (repoId: string) =>
  deserializeBoardThread(window.localStorage.getItem(boardThreadStorageKey(repoId))).map(
    ({ role, text, voice, tone }) => ({ role, text, voice, tone })
  )
const asked = (turnId: string, text: string, source: 'voice' | 'thread' = 'voice'): AdamTurnEvent => ({
  turnId,
  source,
  phase: 'asked',
  text,
  at: 1
})
const answered = (turnId: string, text: string, source: 'voice' | 'thread' = 'voice'): AdamTurnEvent => ({
  turnId,
  source,
  phase: 'answered',
  result: { kind: 'answer', text },
  at: 2
})

beforeEach(() => window.localStorage.clear())

describe('voice turns in the Board thread', () => {
  it('lands a voice turn and a typed turn in the same thread, in order, voice marked', () => {
    const record = createVoiceTurnRecorder(() => 'repo-a')
    record(asked('v1', 'what is running'))
    record(answered('v1', 'Two consoles.'))
    // A typed turn: the thread writes its own rows; its events are not written twice.
    record(asked('t1', '[wrapped prompt]', 'thread'))
    appendToBoardThread('repo-a', { role: 'user', text: 'and the other project?' })
    record(answered('t1', 'One more there.', 'thread'))
    appendToBoardThread('repo-a', { role: 'assistant', text: 'One more there.' })
    expect(thread('repo-a')).toEqual([
      { role: 'user', text: 'what is running', voice: true, tone: undefined },
      { role: 'assistant', text: 'Two consoles.', voice: true, tone: undefined },
      { role: 'user', text: 'and the other project?', voice: undefined, tone: undefined },
      { role: 'assistant', text: 'One more there.', voice: undefined, tone: undefined }
    ])
  })

  it('puts the reply in the thread the question went to after a project switch', () => {
    let repo = 'repo-a'
    const record = createVoiceTurnRecorder(() => repo)
    record(asked('v1', 'status?'))
    repo = 'repo-b'
    record(answered('v1', 'All quiet.'))
    expect(thread('repo-a').map((row) => row.text)).toEqual(['status?', 'All quiet.'])
    expect(thread('repo-b')).toEqual([])
  })

  it('shows a failed voice turn as a plain error row', () => {
    const record = createVoiceTurnRecorder(() => 'repo-a')
    record(asked('v1', 'hello'))
    record({
      turnId: 'v1',
      source: 'voice',
      phase: 'answered',
      result: { kind: 'error', text: 'ADAM is busy with another message.' },
      at: 2
    })
    expect(thread('repo-a')[1]).toMatchObject({ role: 'system', tone: 'error', voice: true })
    expect(thread('repo-a')[1].text).toContain('ADAM is busy with another message.')
  })

  it('hands the row to the thread on screen instead of writing storage behind it', () => {
    const taken: string[] = []
    const off = onBoardThreadAppend((repoId, row) => {
      if (repoId !== 'repo-a') {
        return false
      }
      taken.push(row.text)
      return true
    })
    createVoiceTurnRecorder(() => 'repo-a')(asked('v1', 'hello'))
    off()
    expect(taken).toEqual(['hello'])
    expect(thread('repo-a')).toEqual([])
  })
})
