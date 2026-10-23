import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import {
  MISSION_TIMEOUT_MS,
  advanceMission,
  latestEntryForTab,
  newMission,
  orderSettled,
  outputFileName,
  replyExcerpt
} from './mission-state'

const entry = (
  state: AgentStatusEntry['state'],
  at: number,
  startedAt = at,
  reply?: string,
  prompt = ''
): AgentStatusEntry =>
  ({
    state,
    updatedAt: at,
    stateStartedAt: startedAt,
    prompt,
    paneKey: 't:l',
    stateHistory: [],
    lastAssistantMessage: reply
  }) as AgentStatusEntry

const m0 = newMission({
  orderId: 'o',
  worktreeId: 'w',
  tabId: 't',
  name: 'Claude 1',
  deliveredAt: 100,
  busyAtDelivery: false,
  text: 'Run the unit tests and report failures'
})
const busy = { ...m0, busyAtDelivery: true }

describe('advanceMission', () => {
  it('ignores a "done" from the turn before the delivery', () => {
    expect(advanceMission(m0, entry('done', 100, 50, 'old answer'), 110).state).toBe('running')
  })
  it('closes on the reply to this delivery and keeps its text', () => {
    let m = advanceMission(m0, entry('working', 120), 120)
    expect(m.sawWorking).toBe(true)
    m = advanceMission(m, entry('done', 200, 200, 'All tests pass.'), 200)
    expect(m).toMatchObject({
      state: 'finished',
      reply: 'All tests pass.',
      finishedAt: 200,
      late: false
    })
  })
  it('a done that started after delivery counts even if working was never seen', () => {
    expect(advanceMission(m0, entry('done', 150, 150, 'ok'), 150).state).toBe('finished')
  })
  it('times out, then records a late reply', () => {
    const timedOut = advanceMission(m0, null, 100 + MISSION_TIMEOUT_MS + 1)
    expect(timedOut.state).toBe('timeout')
    const late = advanceMission(timedOut, entry('done', 2e6, 2e6, 'finally'), 2e6)
    expect(late).toMatchObject({ state: 'finished', late: true })
  })
})

describe('busy consoles (reviewer repro)', () => {
  it('does not close on the PREVIOUS turn finishing after we typed', () => {
    // Already working before delivery; that old turn ends at 150.
    let m = advanceMission(busy, entry('working', 120, 50), 120)
    m = advanceMission(m, entry('done', 150, 150, 'old answer'), 150)
    expect(m.state).toBe('running')
    // Our queued order then runs and finishes.
    m = advanceMission(m, entry('working', 160, 160), 160)
    m = advanceMission(m, entry('done', 200, 200, 'new answer'), 200)
    expect(m).toMatchObject({ state: 'finished', reply: 'new answer' })
  })
  it('a matching prompt closes on the right turn even without counting', () => {
    const ours = entry(
      'done',
      150,
      150,
      'ours',
      'Run the unit tests and report failures with file:line'
    )
    expect(advanceMission(busy, ours, 150).state).toBe('finished')
    const theirs = entry('done', 150, 150, 'old', 'Refactor the login form')
    expect(advanceMission(busy, theirs, 150).state).toBe('running')
  })
  it('the same done reported twice is counted once', () => {
    let m = advanceMission(busy, entry('done', 150, 150), 150)
    m = advanceMission(m, entry('done', 155, 150), 155)
    expect(m.donesSeen).toBe(1)
  })
})

describe('helpers', () => {
  it('picks the freshest pane of a tab only', () => {
    const picked = latestEntryForTab(
      { 't:a': entry('working', 1), 't:b': entry('done', 5), 'tt:c': entry('done', 9) },
      't'
    )
    expect(picked?.updatedAt).toBe(5)
  })
  it('settles when nothing is running and someone replied', () => {
    const done = { ...m0, state: 'finished' as const }
    expect(orderSettled([done, { ...m0, state: 'timeout' }])).toBe(true)
    expect(orderSettled([done, m0])).toBe(false)
    expect(orderSettled([{ ...m0, state: 'timeout' }])).toBe(false)
  })
  it('excerpts and names output files', () => {
    expect(replyExcerpt('a\n\n b')).toBe('a b')
    expect(replyExcerpt('x'.repeat(400))).toHaveLength(280)
    expect(outputFileName('Claude 1', Date.UTC(2026, 9, 23, 2, 30))).toBe(
      '2026-10-23_02-30-00-claude-1.md'
    )
  })
})
