import { describe, expect, it } from 'vitest'
import {
  assertTerminalRuntimeBinding,
  isTerminalRuntimeBindingMismatch
} from './terminal-runtime-binding'

describe('terminal runtime binding', () => {
  it('accepts only the expected live runtime identity', () => {
    expect(() => assertTerminalRuntimeBinding(() => 'runtime-a', 'runtime-a')).not.toThrow()
    expect(() => assertTerminalRuntimeBinding(() => 'runtime-b', 'runtime-a')).toThrow(
      'terminal_guard_runtime_mismatch'
    )
    expect(isTerminalRuntimeBindingMismatch(new Error('terminal_guard_runtime_mismatch'))).toBe(
      true
    )
    expect(isTerminalRuntimeBindingMismatch(new Error('unrelated'))).toBe(false)
  })
})
