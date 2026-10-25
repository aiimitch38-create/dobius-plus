import { describe, expect, it } from 'vitest'
import {
  AGENT_PALETTE,
  AgentCursorEventSchema,
  agentColor,
  agentPaletteEntry,
  isAgentId,
  parseAgentCursorEvent,
  type AgentCursorEvent
} from './agent-cursor'

const base: AgentCursorEvent = {
  agentId: 'adam',
  name: 'Adam',
  color: 'oklch(0.56 0.17 255)',
  kind: 'click',
  target: { tileId: 'card-1', x: 10, y: 20 },
  seq: 1,
  ts: 1_700_000_000_000
}

describe('AgentCursorEventSchema', () => {
  it('accepts a tile event, a window event and a gated event', () => {
    expect(parseAgentCursorEvent(base)).toEqual(base)
    expect(
      parseAgentCursorEvent({ ...base, target: { window: true, x: 1, y: 2, w: 3, h: 4 } })
    ).toMatchObject({ target: { window: true } })
    expect(
      parseAgentCursorEvent({
        ...base,
        kind: 'hover',
        gated: { kind: 'purchase', requestId: 'gate-1' },
        runId: 'run-1',
        text: 'Buy now',
        textLength: 7
      })
    ).toMatchObject({ gated: { kind: 'purchase' } })
  })

  it('rejects junk', () => {
    const bad: unknown[] = [
      null,
      'move',
      {},
      { ...base, agentId: 'Adam Smith' },
      { ...base, agentId: '-adam' },
      { ...base, kind: 'teleport' },
      { ...base, seq: -1 },
      { ...base, seq: 1.5 },
      { ...base, ts: 0 },
      { ...base, target: { tileId: 'c', x: Number.NaN, y: 0 } },
      { ...base, target: { tileId: 'c', x: 0, y: 0, w: -5 } },
      { ...base, target: { x: 0, y: 0 } },
      { ...base, target: { window: false, x: 0, y: 0 } },
      { ...base, gated: { kind: 'nuke', requestId: 'g' } },
      { ...base, gated: { kind: 'send' } },
      { ...base, extra: 1 },
      { ...base, name: '' },
      { ...base, text: 'x'.repeat(2001) }
    ]
    for (const input of bad) {
      expect(AgentCursorEventSchema.safeParse(input).success, JSON.stringify(input)).toBe(false)
    }
  })
})

describe('agentColor', () => {
  it('maps Adam to the blue slot in both schemes', () => {
    expect(agentColor('adam')).toBe('oklch(0.56 0.17 255)')
    expect(agentColor('adam', 'dark')).toBe('oklch(0.70 0.15 255)')
    expect(agentColor('Adam')).toBe('oklch(0.56 0.17 255)')
    expect(agentPaletteEntry('adam-2').slot).toBe('agent-1')
  })

  it('is deterministic and never gives another agent Adam\'s slot', () => {
    for (const id of ['maya', 'lead-acme', 'worker-1', 'hermes', 'codex_42']) {
      expect(agentColor(id)).toBe(agentColor(id))
      expect(agentPaletteEntry(id).slot).not.toBe('agent-1')
      expect(AGENT_PALETTE.some((p) => p.light === agentColor(id))).toBe(true)
    }
  })

  it('isAgentId matches the CLI pattern', () => {
    expect(isAgentId('adam')).toBe(true)
    expect(isAgentId('a'.repeat(64))).toBe(true)
    expect(isAgentId('a'.repeat(65))).toBe(false)
    expect(isAgentId('Adam')).toBe(false)
    expect(isAgentId(42)).toBe(false)
  })
})
