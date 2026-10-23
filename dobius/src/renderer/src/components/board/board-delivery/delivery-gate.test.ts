import { describe, expect, it } from 'vitest'
import {
  DeliveryGate,
  HOLD_MAX_MS,
  deliveryDecision,
  type ConsoleDeliveryState
} from './delivery-gate'

function harness(states: Record<string, ConsoleDeliveryState>) {
  let clock = 0
  const sent: string[] = []
  const holds: string[] = []
  let concurrent = 0
  let maxConcurrent = 0
  const gate = new DeliveryGate({
    stateOf: (tabId) => states[tabId] ?? 'gone',
    send: async (tabId, text) => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await Promise.resolve()
      sent.push(`${tabId}:${text}`)
      concurrent -= 1
      return 'sent'
    },
    wait: async (ms) => {
      clock += ms
    },
    now: () => clock,
    onHold: (r) => holds.push(r.tabId)
  })
  return { gate, sent, holds, states, maxConcurrent: () => maxConcurrent }
}

describe('deliveryDecision', () => {
  it('sends to idle/done, sends with a busy note to working, holds on dialogs, skips the rest', () => {
    expect(deliveryDecision('idle')).toEqual({ kind: 'send', busy: false })
    expect(deliveryDecision('working')).toEqual({ kind: 'send', busy: true })
    expect(deliveryDecision('waiting')).toEqual({ kind: 'hold' })
    expect(deliveryDecision('blocked')).toEqual({ kind: 'hold' })
    expect(deliveryDecision('shell')).toEqual({ kind: 'skip', reason: 'shell' })
    expect(deliveryDecision('paused')).toEqual({ kind: 'skip', reason: 'paused' })
  })
})

describe('DeliveryGate', () => {
  it('types one message at a time, in order', async () => {
    const h = harness({ a: 'idle', b: 'working' })
    const results = await Promise.all([
      h.gate.enqueue({ orderId: 'o', tabId: 'a', text: '1' }),
      h.gate.enqueue({ orderId: 'o', tabId: 'b', text: '2' }),
      h.gate.enqueue({ orderId: 'o', tabId: 'a', text: '3' })
    ])
    expect(h.sent).toEqual(['a:1', 'b:2', 'a:3'])
    expect(h.maxConcurrent()).toBe(1)
    expect(results[1]).toEqual({ kind: 'sent', busy: true })
  })

  it('holds while a console is on a dialog, then delivers once it clears', async () => {
    const h = harness({ a: 'waiting' })
    const pending = h.gate.enqueue({ orderId: 'o', tabId: 'a', text: 'go' })
    await Promise.resolve()
    h.states.a = 'idle'
    expect(await pending).toEqual({ kind: 'sent', busy: false })
    expect(h.holds).toEqual(['a'])
  })

  it('drops a message held on a dialog too long', async () => {
    const h = harness({ a: 'blocked' })
    expect(await h.gate.enqueue({ orderId: 'o', tabId: 'a', text: 'go' })).toEqual({
      kind: 'skipped',
      reason: 'held-too-long'
    })
    expect(h.sent).toEqual([])
    expect(HOLD_MAX_MS).toBe(300_000)
  })

  it('skips paused, shell and gone consoles with a reason', async () => {
    const h = harness({ p: 'paused', s: 'shell' })
    expect(await h.gate.enqueue({ orderId: 'o', tabId: 'p', text: 'x' })).toMatchObject({
      reason: 'paused'
    })
    expect(await h.gate.enqueue({ orderId: 'o', tabId: 's', text: 'x' })).toMatchObject({
      reason: 'shell'
    })
    expect(await h.gate.enqueue({ orderId: 'o', tabId: 'missing', text: 'x' })).toMatchObject({
      reason: 'gone'
    })
  })

  it('cancel drops untyped messages of that order only', async () => {
    const h = harness({ a: 'waiting', b: 'idle' })
    const held = h.gate.enqueue({ orderId: 'o1', tabId: 'a', text: 'held' })
    const queued = h.gate.enqueue({ orderId: 'o1', tabId: 'b', text: 'queued' })
    const other = h.gate.enqueue({ orderId: 'o2', tabId: 'b', text: 'other' })
    expect(h.gate.cancelOrder('o1')).toBe(2)
    expect(await queued).toEqual({ kind: 'skipped', reason: 'cancelled' })
    expect(await held).toEqual({ kind: 'skipped', reason: 'cancelled' })
    expect(await other).toEqual({ kind: 'sent', busy: false })
    expect(h.sent).toEqual(['b:other'])
  })

  it('a console on a dialog does not hold up other consoles', async () => {
    const h = harness({ a: 'waiting', b: 'idle' })
    const held = h.gate.enqueue({ orderId: 'o', tabId: 'a', text: 'held' })
    expect(await h.gate.enqueue({ orderId: 'o', tabId: 'b', text: 'free' })).toEqual({
      kind: 'sent',
      busy: false
    })
    expect(h.sent).toEqual(['b:free'])
    h.states.a = 'idle'
    expect(await held).toEqual({ kind: 'sent', busy: false })
  })
})
