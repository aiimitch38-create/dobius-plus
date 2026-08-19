import { describe, expect, it } from 'vitest'
import { classifyOutcome, isUnimplementedError, skipped, type InvokeOutcome } from './classify'

describe('classifyOutcome', () => {
  it('reports UNIMPLEMENTED only for the exact seam error tauri.ts throws', () => {
    const outcome: InvokeOutcome = {
      threw: true,
      message: 'Dobius Communications command is not implemented: publish_note'
    }
    expect(classifyOutcome(outcome)).toEqual({ verdict: 'UNIMPLEMENTED' })
  })

  // This is the harness's required self-check: a command that genuinely
  // threw must never be reported as PASS. A harness that can produce false
  // PASSes is worse than no harness.
  it('does not report PASS when the command actually threw', () => {
    const outcome: InvokeOutcome = { threw: true, message: 'Missing channel id' }
    const result = classifyOutcome(outcome)
    expect(result.verdict).not.toBe('PASS')
    expect(result.verdict).toBe('ERROR')
    expect(result.detail).toBe('Missing channel id')
  })

  it('does not report PASS for a thrown error that merely mentions "not implemented" out of context', () => {
    // Guards against a naive substring match: only the exact seam prefix
    // counts as UNIMPLEMENTED, so an unrelated handler bug whose message
    // happens to contain that phrase must still surface as ERROR.
    const outcome: InvokeOutcome = {
      threw: true,
      message: 'Feature X is not implemented: this is a different failure'
    }
    const result = classifyOutcome(outcome)
    expect(result.verdict).toBe('ERROR')
  })

  it('reports PASS for a successful result with no shape oracle', () => {
    const outcome: InvokeOutcome = { threw: false, result: { ok: true } }
    expect(classifyOutcome(outcome)).toEqual({ verdict: 'PASS' })
  })

  it('reports PASS when the result satisfies the shape oracle', () => {
    const outcome: InvokeOutcome = { threw: false, result: { id: 'abc' } }
    const result = classifyOutcome(outcome, (value) =>
      value && typeof value === 'object' && 'id' in value
        ? { ok: true }
        : { ok: false, reason: 'missing id' }
    )
    expect(result).toEqual({ verdict: 'PASS' })
  })

  it('reports SHAPE_FAIL with a reason when the result fails the shape oracle', () => {
    const outcome: InvokeOutcome = { threw: false, result: { wrong: true } }
    const result = classifyOutcome(outcome, () => ({ ok: false, reason: 'missing id field' }))
    expect(result).toEqual({ verdict: 'SHAPE_FAIL', detail: 'missing id field' })
  })

  it('never runs the shape oracle when the command threw', () => {
    let called = false
    const outcome: InvokeOutcome = { threw: true, message: 'boom' }
    classifyOutcome(outcome, () => {
      called = true
      return { ok: true }
    })
    expect(called).toBe(false)
  })
})

describe('isUnimplementedError', () => {
  it('matches the literal prefix tauri.ts throws', () => {
    expect(isUnimplementedError('Dobius Communications command is not implemented: foo')).toBe(true)
  })

  it('rejects messages that do not start with the exact prefix', () => {
    expect(isUnimplementedError('foo: Dobius Communications command is not implemented: bar')).toBe(
      false
    )
    expect(isUnimplementedError('command is not implemented: foo')).toBe(false)
  })
})

describe('skipped', () => {
  it('carries the reason as detail', () => {
    expect(skipped('classified removed-pending')).toEqual({
      verdict: 'SKIPPED',
      detail: 'classified removed-pending'
    })
  })
})

describe('classifyOutcome with options.expectedError', () => {
  it('reports PASS when the thrown message matches the expected-error predicate', () => {
    const outcome: InvokeOutcome = { threw: true, message: 'Dobius has no external-runtime installer' }
    const result = classifyOutcome(outcome, undefined, {
      expectedError: (message) => message.includes('no external-runtime installer')
    })
    expect(result.verdict).toBe('PASS')
    expect(result.detail).toContain('Dobius has no external-runtime installer')
  })

  // The self-check this option exists to protect against: a command whose
  // rejection reason DRIFTS to something unexpected must still surface as a
  // real ERROR, not get silently absorbed just because SOME expectedError
  // predicate is present on the step.
  it('does not report PASS when the thrown message does not match the predicate', () => {
    const outcome: InvokeOutcome = { threw: true, message: 'a completely different failure' }
    const result = classifyOutcome(outcome, undefined, {
      expectedError: (message) => message.includes('no external-runtime installer')
    })
    expect(result.verdict).toBe('ERROR')
    expect(result.detail).toBe('a completely different failure')
  })

  it('still reports UNIMPLEMENTED for the seam error even when expectedError is set', () => {
    const outcome: InvokeOutcome = {
      threw: true,
      message: 'Dobius Communications command is not implemented: install_acp_runtime'
    }
    const result = classifyOutcome(outcome, undefined, { expectedError: () => true })
    expect(result.verdict).toBe('UNIMPLEMENTED')
  })

  it('reports SHAPE_FAIL when a command with expectedError set does not actually throw', () => {
    const outcome: InvokeOutcome = { threw: false, result: { ok: true } }
    const result = classifyOutcome(outcome, undefined, { expectedError: () => true })
    expect(result.verdict).toBe('SHAPE_FAIL')
    expect(result.detail).toMatch(/expected this command to always reject/)
  })
})
