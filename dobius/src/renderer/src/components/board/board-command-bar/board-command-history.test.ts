import { describe, expect, it } from 'vitest'
import { boardCommandHistory, stepBoardCommandHistory } from './board-command-history'

const user = (text: string, transient = false) => ({ role: 'user' as const, text, transient })

describe('boardCommandHistory', () => {
  it('keeps only sent user commands, oldest first', () => {
    expect(
      boardCommandHistory([
        user('spawn 2 claude'),
        { role: 'assistant', text: 'done' },
        { role: 'system', text: 'relayed' },
        user('@Reviewer go')
      ])
    ).toEqual(['spawn 2 claude', '@Reviewer go'])
  })

  it('skips transient, blank and consecutive duplicate rows', () => {
    expect(
      boardCommandHistory([user('a'), user('a'), user('  '), user('b', true), user('c'), user('a')])
    ).toEqual(['a', 'c', 'a'])
  })

  it('caps at the newest 50 by default', () => {
    const messages = Array.from({ length: 60 }, (_, i) => user(`cmd ${i}`))
    const history = boardCommandHistory(messages)
    expect(history).toHaveLength(50)
    expect(history[0]).toBe('cmd 10')
    expect(history.at(-1)).toBe('cmd 59')
  })
})

describe('stepBoardCommandHistory', () => {
  const history = ['one', 'two', 'three']
  const idle = { index: null, draft: '' }

  it('Up from the draft saves it and shows the newest entry', () => {
    expect(stepBoardCommandHistory(history, idle, 'up', 'half typed')).toEqual({
      cursor: { index: 2, draft: 'half typed' },
      text: 'three'
    })
  })

  it('Up walks older and stops at the oldest', () => {
    let step = stepBoardCommandHistory(history, idle, 'up', '')
    step = stepBoardCommandHistory(history, step.cursor, 'up', '')
    step = stepBoardCommandHistory(history, step.cursor, 'up', '')
    expect(step.text).toBe('one')
    step = stepBoardCommandHistory(history, step.cursor, 'up', '')
    expect(step).toEqual({ cursor: { index: 0, draft: '' }, text: 'one' })
  })

  it('Down walks newer and then returns the saved draft', () => {
    let step = stepBoardCommandHistory(history, idle, 'up', 'draft')
    step = stepBoardCommandHistory(history, step.cursor, 'up', '')
    step = stepBoardCommandHistory(history, step.cursor, 'down', '')
    expect(step.text).toBe('three')
    step = stepBoardCommandHistory(history, step.cursor, 'down', '')
    expect(step).toEqual({ cursor: { index: null, draft: '' }, text: 'draft' })
  })

  it('does nothing for Up with no history or Down while on the draft', () => {
    expect(stepBoardCommandHistory([], idle, 'up', 'x').text).toBeNull()
    expect(stepBoardCommandHistory(history, idle, 'down', 'x').text).toBeNull()
  })

  it('clamps a stale index when history shrank', () => {
    expect(stepBoardCommandHistory(['a'], { index: 5, draft: '' }, 'up', '').text).toBe('a')
  })
})
