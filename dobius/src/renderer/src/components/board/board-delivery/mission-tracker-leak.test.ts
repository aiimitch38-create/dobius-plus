/**
 * Memory-leak regression: the mission tracker must stay bounded.
 *
 * Every delivered order adds one mission per lane, and each finished mission
 * holds the agent's full last reply. Nothing ever removed them, so a long
 * session kept every reply ever received. Missions now live exactly as long
 * as their order stays in the orders registry (last 50), unless a
 * forward/handoff wait pins them.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ agentStatusByPaneKey: {} }), subscribe: () => () => {} }
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionId: () => null }))

import { recordOrder } from './board-orders'
import { newMission } from './mission-state'
import {
  missionsForOrder,
  pinOrderMissions,
  trackMission,
  trackedMissionCountForTest
} from './mission-tracker'

const MAX_ORDERS = 50
const LANES = 3
let seq = 0

function record(id: string): void {
  recordOrder({ id, worktreeId: 'wt', text: 'do it', createdAt: seq, lanes: [] })
}

function track(orderId: string, lane: number): void {
  seq += 1
  trackMission(
    newMission({
      orderId,
      worktreeId: 'wt',
      tabId: `tab-${lane}`,
      name: `Console ${lane}`,
      deliveredAt: seq,
      busyAtDelivery: false,
      text: 'x'.repeat(200)
    })
  )
}

describe('mission tracker memory bound', () => {
  it('keeps missions only for the last 50 orders across 10,000 orders', () => {
    vi.useFakeTimers()
    for (let i = 0; i < 10_000; i += 1) {
      record(`order-${i}`)
      for (let lane = 0; lane < LANES; lane += 1) {
        track(`order-${i}`, lane)
      }
    }
    expect(trackedMissionCountForTest().missions).toBeLessThanOrEqual(MAX_ORDERS * LANES)
    expect(missionsForOrder('order-9999')).toHaveLength(LANES)
    expect(missionsForOrder(`order-${10_000 - MAX_ORDERS}`)).toHaveLength(LANES)
    expect(missionsForOrder('order-0')).toHaveLength(0)
    vi.useRealTimers()
  })

  it('a late delivery of an old order neither evicts a newer one nor revives an evicted one', () => {
    record('slow')
    for (let i = 0; i < MAX_ORDERS - 1; i += 1) {
      record(`fast-${i}`)
      track(`fast-${i}`, 0)
    }
    // "slow" is still retained: its late lane is kept and nothing newer goes.
    track('slow', 0)
    expect(missionsForOrder('slow')).toHaveLength(1)
    expect(missionsForOrder('fast-0')).toHaveLength(1)
    // One more order pushes "slow" out of the registry, and its missions with it.
    record('newest')
    expect(missionsForOrder('slow')).toHaveLength(0)
    expect(missionsForOrder('fast-0')).toHaveLength(1)
    // A lane of "slow" that finishes delivering now is ignored.
    track('slow', 1)
    expect(missionsForOrder('slow')).toHaveLength(0)
  })

  it('keeps a pinned order past eviction until the wait releases it', () => {
    record('watched')
    track('watched', 0)
    const release = pinOrderMissions('watched')
    for (let i = 0; i < MAX_ORDERS + 5; i += 1) {
      record(`later-${i}`)
      track(`later-${i}`, 0)
    }
    track('watched', 1)
    expect(missionsForOrder('watched')).toHaveLength(2)
    release()
    expect(missionsForOrder('watched')).toHaveLength(0)
    expect(trackedMissionCountForTest().missions).toBeLessThanOrEqual(MAX_ORDERS * LANES)
  })

  it('accepts a held lane of a pinned order that left the registry before delivery', () => {
    // deliverOrder({ pinMissions: true }) pins before recording, as a handoff does.
    const release = pinOrderMissions('held')
    record('held')
    for (let i = 0; i < MAX_ORDERS + 5; i += 1) {
      record(`burst-${i}`)
    }
    track('held', 0)
    expect(missionsForOrder('held')).toHaveLength(1)
    release()
    expect(missionsForOrder('held')).toHaveLength(0)
  })
})
