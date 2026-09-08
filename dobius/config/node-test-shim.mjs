// Why: the restored Communications tree ships 355 *.test.mjs files written
// against node's built-in runner (`import test from "node:test"`), but they
// import source via vitest-only aliases (@comms/*), so `node --test` cannot
// resolve them and vitest reported "No test suite found" for every one of
// them — 355 test files silently not running.
//
// Aliasing 'node:test' to this shim lets both be true at once: the files stay
// unmodified, and vitest actually executes them.
import { afterEach, beforeAll, afterAll, beforeEach, describe, it, vi } from 'vitest'

// node:test allows test(name, options, fn); vitest is test(name, fn). Drop the
// options object so the callback is not mistaken for the test body.
function normalize(args) {
  const [name, second, third] = args
  const fn = typeof second === 'function' ? second : third
  return [name, fn]
}

const test = (...args) => it(...normalize(args))
test.skip = (...args) => it.skip(...normalize(args))
test.only = (...args) => it.only(...normalize(args))
test.todo = (...args) => it.todo(...normalize(args))
test.describe = describe

// node:test's `mock` surface, mapped onto vitest's `vi`.
const mock = {
  fn: (...a) => vi.fn(...a),
  method: (obj, key, impl) =>
    impl ? vi.spyOn(obj, key).mockImplementation(impl) : vi.spyOn(obj, key),
  reset: () => vi.resetAllMocks(),
  restoreAll: () => vi.restoreAllMocks(),
  timers: {
    enable: () => vi.useFakeTimers(),
    reset: () => vi.useRealTimers(),
    tick: (ms) => vi.advanceTimersByTime(ms)
  }
}

export default test
export { test, describe, it, beforeEach, afterEach, beforeAll, afterAll, mock }
export const before = beforeAll
export const after = afterAll
