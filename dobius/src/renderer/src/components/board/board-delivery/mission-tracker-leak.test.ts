/**
 * Memory-leak regression: the mission tracker must stay bounded.
 *
 * Every delivered order adds one mission per lane, and each finished mission
 * holds the agent's full last reply. Nothing ever removed them, so a long
 * session kept every reply ever received. The tracker now keeps missions for
 * the same number of orders the orders registry keeps (50).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ agentStatusByPaneKey: {} }), subscribe: () => () => {} }
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionId: () => null }))

import { newMission } from './mission-state'
import { missionsForOrder, trackMission, trackedMissionCountForTest } from './mission-tracker'

const MAX_ORDERS = 50
const LANES = 3

describe('mission tracker memory bound', () => {
  it('keeps missions for at most the last 50 orders across 10,000 orders', () => {
    vi.useFakeTimers()
    for (let i = 0; i < 10_000; i += 1) {
      for (let lane = 0; lane < LANES; lane += 1) {
        trackMission(
          newMission({
            orderId: `order-${i}`,
            worktreeId: 'wt',
            tabId: `tab-${lane}`,
            name: `Console ${lane}`,
            deliveredAt: i,
            busyAtDelivery: false,
            text: 'x'.repeat(200)
          })
        )
      }
    }
    expect(trackedMissionCountForTest().missions).toBeLessThanOrEqual(MAX_ORDERS * LANES)
    expect(missionsForOrder('order-9999')).toHaveLength(LANES)
    expect(missionsForOrder(`order-${10_000 - MAX_ORDERS}`)).toHaveLength(LANES)
    expect(missionsForOrder('order-0')).toHaveLength(0)
    vi.useRealTimers()
  })
})
