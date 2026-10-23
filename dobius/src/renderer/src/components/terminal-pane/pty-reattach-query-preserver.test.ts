import { describe, expect, it, vi } from 'vitest'
import { createPtyReattachQueryPreserver } from './pty-reattach-query-preserver'

describe('PTY reattach query preserver', () => {
  it('recognizes only supported stateless query frames across callback chunks', () => {
    const onQuery = vi.fn()
    const preserver = createPtyReattachQueryPreserver(onQuery)

    for (const character of '\x1b[c\x1b[14t\x1b]11;?\x1b\\') {
      preserver.pushOverflowData(character)
    }
    preserver.pushOverflowData('\x1b[6n\x1b[?6n')

    expect(onQuery.mock.calls.map(([query]) => query)).toEqual([
      { kind: 'da1', data: '\x1b[c' },
      { kind: 'pixel-14', data: '\x1b[14t' },
      { kind: 'osc-color', data: '\x1b]11;?\x1b\\' }
    ])
  })

  it('continues only a query started before release and returns its orphaned suffix length', () => {
    const onQuery = vi.fn()
    const preserver = createPtyReattachQueryPreserver(onQuery)
    preserver.pushOverflowData('\x1b[14')

    const consumedChars = preserver.continuePendingQuery('tvisible\x1b[c')

    expect(consumedChars).toBe(1)
    expect(onQuery.mock.calls.map(([query]) => query)).toEqual([
      { kind: 'pixel-14', data: '\x1b[14t' }
    ])
  })

  it('drops a pending query when the reattach generation is discarded', () => {
    const onQuery = vi.fn()
    const preserver = createPtyReattachQueryPreserver(onQuery)
    preserver.pushOverflowData('\x1b[14')
    preserver.reset()

    expect(preserver.continuePendingQuery('t')).toBe(0)
    expect(onQuery).not.toHaveBeenCalled()
  })

  it('suppresses unsupported CSI through its final byte and preserves following text', () => {
    const onQuery = vi.fn()
    const preserver = createPtyReattachQueryPreserver(onQuery)
    preserver.pushOverflowData('\x1b[6')

    expect(preserver.continuePendingQuery('nvisible')).toBe(1)
    expect(onQuery).not.toHaveBeenCalled()
  })

  it.each(['\x07', '\x1b\\'])(
    'suppresses malformed OSC through %j and preserves following text',
    (terminator) => {
      const onQuery = vi.fn()
      const preserver = createPtyReattachQueryPreserver(onQuery)
      preserver.pushOverflowData('\x1b]10;?;')

      const orphan = `malformed ${'x'.repeat(128)}${terminator}`
      expect(preserver.continuePendingQuery(`${orphan}visible`)).toBe(orphan.length)
      expect(onQuery).not.toHaveBeenCalled()
    }
  )

  it('does not recognize query-looking frames nested in string controls and resumes after ST', () => {
    const onQuery = vi.fn()
    const preserver = createPtyReattachQueryPreserver(onQuery)
    preserver.pushOverflowData('\x1bPpayload\x1b[c')
    expect(preserver.continuePendingQuery('\x1b\\visible')).toBe(2)
    expect(onQuery).not.toHaveBeenCalled()
  })

  it.each(['P', '^', '_', 'X'])(
    'ignores embedded query-looking bytes inside ESC %s string payload',
    (introducer) => {
      const onQuery = vi.fn()
      const preserver = createPtyReattachQueryPreserver(onQuery)
      preserver.pushOverflowData(`\x1b${introducer}payload\x1b[c\x07`)
      expect(preserver.continuePendingQuery('\x1b\\visible')).toBe(2)
      expect(onQuery).not.toHaveBeenCalled()
    }
  )

  it('keeps bounded framing across split escape and CSI chunks', () => {
    const onQuery = vi.fn()
    const preserver = createPtyReattachQueryPreserver(onQuery)
    preserver.pushOverflowData('\x1b')
    preserver.pushOverflowData('(')
    expect(preserver.continuePendingQuery('0visible')).toBe(1)
    preserver.pushOverflowData('\x1b[?')
    expect(preserver.continuePendingQuery('25lvisible')).toBe(3)
    expect(onQuery).not.toHaveBeenCalled()
  })

  it('terminates an orphaned string frame on CAN or SUB without consuming later text', () => {
    for (const cancel of ['\x18', '\x1a']) {
      const onQuery = vi.fn()
      const preserver = createPtyReattachQueryPreserver(onQuery)
      preserver.pushOverflowData('\x1b]10;?;payload')
      expect(preserver.continuePendingQuery(`${cancel}visible`)).toBe(1)
      expect(onQuery).not.toHaveBeenCalled()
    }
  })

  it('suppresses 8-bit C1 OSC and string frames through ST', () => {
    const onQuery = vi.fn()
    const oscPreserver = createPtyReattachQueryPreserver(onQuery)
    oscPreserver.pushOverflowData('\x9d10;?;malformed')
    expect(oscPreserver.continuePendingQuery('\x9cvisible')).toBe(1)

    const stringPreserver = createPtyReattachQueryPreserver(onQuery)
    stringPreserver.pushOverflowData('\x90payload\x1b[c')
    expect(stringPreserver.continuePendingQuery('\x9cvisible')).toBe(1)
    expect(onQuery).not.toHaveBeenCalled()
  })
})
