import { describe, expect, it } from 'vitest'
import { summarizeDelivery } from './delivery-summary'

describe('summarizeDelivery', () => {
  it('groups sent and busy, and explains skips', () => {
    const s = summarizeDelivery([
      { name: 'A', outcome: { kind: 'sent', busy: false } },
      { name: 'B', outcome: { kind: 'sent', busy: true } },
      { name: 'C', outcome: { kind: 'skipped', reason: 'shell' } }
    ])
    expect(s.ok).toBe(true)
    expect(s.text).toContain('Sent to A.')
    expect(s.text).toContain('B busy, will take it after the current turn.')
    expect(s.text).toContain('C is at its shell')
  })
  it('is not ok when nothing was delivered', () => {
    expect(
      summarizeDelivery([{ name: 'A', outcome: { kind: 'skipped', reason: 'paused' } }]).ok
    ).toBe(false)
    expect(summarizeDelivery([]).text).toBe('No console to send to.')
  })
})
