import { describe, expect, it } from 'vitest'
import { getAgentIdentityTarget } from './selectors'

const flags = (entries: Record<string, string | boolean> = {}): Map<string, string | boolean> =>
  new Map(Object.entries(entries))

describe('getAgentIdentityTarget', () => {
  it('adds nothing for a human-driven command', () => {
    expect(getAgentIdentityTarget(flags(), {})).toEqual({})
    expect(getAgentIdentityTarget(flags({ fast: true }), {})).toEqual({})
  })

  it('reads --as, lowercased, with --fast', () => {
    expect(getAgentIdentityTarget(flags({ as: 'Adam', fast: true }), {})).toEqual({
      agent: 'adam',
      fast: true
    })
  })

  it('falls back to DOBIUS_AGENT_ID / DOBIUS_AGENT_NAME; --as wins over the env', () => {
    expect(
      getAgentIdentityTarget(flags(), { DOBIUS_AGENT_ID: 'maya', DOBIUS_AGENT_NAME: 'Maya Chen' })
    ).toEqual({ agent: 'maya', agentName: 'Maya Chen' })
    expect(getAgentIdentityTarget(flags({ as: 'adam' }), { DOBIUS_AGENT_ID: 'maya' })).toEqual({
      agent: 'adam'
    })
  })

  it('rejects malformed agent ids', () => {
    expect(() => getAgentIdentityTarget(flags({ as: 'bad id!' }), {})).toThrow(/Invalid agent id/)
    expect(() => getAgentIdentityTarget(flags(), { DOBIUS_AGENT_ID: 'x'.repeat(65) })).toThrow(
      /Invalid agent id/
    )
  })

  it('rejects reserved and malformed display names', () => {
    for (const name of ['Carson', 'carson', 'System', 'Dobius', 'You', 'Carson.', 'Carson 2', 'Dobius AI', 'You-', 'S.Y.S.T.E.M']) {
      expect(() =>
        getAgentIdentityTarget(flags({ as: 'adam' }), { DOBIUS_AGENT_NAME: name })
      ).toThrow(/reserved/)
    }
    for (const name of ['<b>Adam</b>', 'Adam\nX', 'a'.repeat(33), 'Adam!']) {
      expect(() =>
        getAgentIdentityTarget(flags({ as: 'adam' }), { DOBIUS_AGENT_NAME: name })
      ).toThrow(/Invalid agent name/)
    }
    expect(
      getAgentIdentityTarget(flags({ as: 'adam' }), { DOBIUS_AGENT_NAME: 'Adam J. Agent-2' })
    ).toEqual({ agent: 'adam', agentName: 'Adam J. Agent-2' })
  })
})
