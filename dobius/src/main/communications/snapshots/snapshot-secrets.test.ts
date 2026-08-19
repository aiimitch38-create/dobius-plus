import { describe, expect, it } from 'vitest'
import { looksTokenShaped, safeAccountIdOrNull } from './snapshot-secrets'

describe('snapshot-secrets', () => {
  it('treats a short opaque uuid-like id as safe', () => {
    expect(looksTokenShaped('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(false)
  })

  it('flags long opaque strings as token-shaped', () => {
    expect(looksTokenShaped('x'.repeat(200))).toBe(true)
  })

  it('flags common credential prefixes', () => {
    expect(looksTokenShaped('sk-abcdef1234567890')).toBe(true)
    expect(looksTokenShaped('Bearer abcdef')).toBe(true)
    expect(looksTokenShaped('ghp_abcdef1234567890')).toBe(true)
    expect(looksTokenShaped('xoxb-1234-5678')).toBe(true)
  })

  it('flags JWT-shaped triples', () => {
    expect(looksTokenShaped('eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM')).toBe(true)
  })

  it('safeAccountIdOrNull passes through a safe id, nulls out anything token-shaped or empty', () => {
    expect(safeAccountIdOrNull('acct-1234')).toBe('acct-1234')
    expect(safeAccountIdOrNull(null)).toBeNull()
    expect(safeAccountIdOrNull(undefined)).toBeNull()
    expect(safeAccountIdOrNull('  ')).toBeNull()
    expect(safeAccountIdOrNull('sk-realsecretvalue')).toBeNull()
    expect(safeAccountIdOrNull('x'.repeat(200))).toBeNull()
  })
})
