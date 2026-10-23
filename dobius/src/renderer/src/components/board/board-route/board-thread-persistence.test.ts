import { describe, expect, it } from 'vitest'
import type { BoardThreadMessage } from '../board-command-bar/BoardThread'
import {
  BOARD_THREAD_HISTORY_CAP,
  boardThreadStorageKey,
  deserializeBoardThread,
  serializeBoardThread
} from './board-thread-persistence'

function message(id: string, extra: Partial<BoardThreadMessage> = {}): BoardThreadMessage {
  return { id, role: 'user', text: `text-${id}`, ...extra }
}

describe('boardThreadStorageKey', () => {
  it('namespaces by repo id', () => {
    expect(boardThreadStorageKey('repo-1')).toBe('dobius.board.thread.v1.repo-1')
  })
})

describe('serializeBoardThread', () => {
  it('caps to the most recent BOARD_THREAD_HISTORY_CAP messages', () => {
    const messages = Array.from({ length: BOARD_THREAD_HISTORY_CAP + 10 }, (_, i) =>
      message(String(i))
    )
    const parsed = JSON.parse(serializeBoardThread(messages))
    expect(parsed).toHaveLength(BOARD_THREAD_HISTORY_CAP)
    expect(parsed[0].id).toBe('10')
    expect(parsed.at(-1).id).toBe(String(BOARD_THREAD_HISTORY_CAP + 9))
  })

  it('drops transient rows and action callbacks, keeps report', () => {
    const report = { agent: 'Claude 1', consoleTitle: 'Review', excerpt: 'e', full: 'f', at: 1 }
    const messages: BoardThreadMessage[] = [
      message('thinking', { transient: true }),
      message('with-action', { action: { label: 'Retry', onClick: () => {} } }),
      message('with-report', { report })
    ]
    const parsed = JSON.parse(serializeBoardThread(messages))
    expect(parsed).toHaveLength(2)
    expect(parsed.map((m: { id: string }) => m.id)).toEqual(['with-action', 'with-report'])
    expect(parsed[0].action).toBeUndefined()
    expect(parsed[1].report).toEqual(report)
  })
})

describe('deserializeBoardThread', () => {
  it('round-trips a serialized thread', () => {
    const messages = [message('a'), message('b', { tone: 'error' })]
    const restored = deserializeBoardThread(serializeBoardThread(messages))
    expect(restored).toEqual(messages.map(({ id, role, text, tone }) => ({ id, role, text, tone })))
  })

  it('returns [] for null, corrupt JSON, or a non-array payload', () => {
    expect(deserializeBoardThread(null)).toEqual([])
    expect(deserializeBoardThread('{not json')).toEqual([])
    expect(deserializeBoardThread('{"a":1}')).toEqual([])
  })

  it('drops malformed entries missing required fields', () => {
    const raw = JSON.stringify([{ id: 'ok', role: 'user', text: 'hi' }, { id: 'bad' }])
    expect(deserializeBoardThread(raw)).toEqual([{ id: 'ok', role: 'user', text: 'hi' }])
  })
})
