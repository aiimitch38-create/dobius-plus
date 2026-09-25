import { createHash, timingSafeEqual } from 'node:crypto'

// Why: `===` on a secret returns at the first differing byte, which leaks how
// much of a guessed token was right. Hashing both sides first gives equal-length
// buffers, so timingSafeEqual never throws on a wrong-length or non-string
// guess and a mismatch reveals nothing about which bytes matched.
export function constantTimeEqual(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== 'string' || expected.length === 0) {
    return false
  }
  const a = createHash('sha256').update(candidate, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}
