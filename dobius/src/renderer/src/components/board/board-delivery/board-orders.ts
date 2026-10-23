import type { DeliveryOutcome } from './delivery-gate'

// The Board's record of orders it typed into consoles: what was asked, who got
// it, and how each lane's delivery went. Cancel, report and the mission tracker
// all read from here. ponytail: in memory per window; a restart forgets it.

export type OrderLane = {
  tabId: string
  name: string
  outcome: DeliveryOutcome | null
  deliveredAt: number | null
}
export type BoardOrder = {
  id: string
  worktreeId: string
  text: string
  createdAt: number
  lanes: OrderLane[]
}

const MAX_ORDERS = 50
const orders: BoardOrder[] = []
const listeners = new Set<() => void>()

export function recordOrder(order: BoardOrder): void {
  orders.push(order)
  if (orders.length > MAX_ORDERS) {
    orders.shift()
  }
  notify()
}

export function updateOrderLane(
  orderId: string,
  tabId: string,
  outcome: DeliveryOutcome,
  at: number
): void {
  const lane = orders.find((o) => o.id === orderId)?.lanes.find((l) => l.tabId === tabId)
  if (lane) {
    lane.outcome = outcome
    lane.deliveredAt = outcome.kind === 'sent' ? at : null
    notify()
  }
}

export function latestOrder(worktreeId: string): BoardOrder | null {
  for (let i = orders.length - 1; i >= 0; i -= 1) {
    if (orders[i].worktreeId === worktreeId) {
      return orders[i]
    }
  }
  return null
}

export function ordersFor(worktreeId: string): readonly BoardOrder[] {
  return orders.filter((o) => o.worktreeId === worktreeId)
}

export function onOrdersChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  for (const l of listeners) {
    l()
  }
}

export function resetBoardOrdersForTest(): void {
  orders.length = 0
  listeners.clear()
}
