import { Script, createContext } from 'node:vm'

// Why: loop patterns are user input running on the main process. The shape
// check in automation-loops.ts rejects the obvious catastrophic forms, but no
// heuristic is complete, so the match itself runs under a hard time budget:
// V8 interrupts a runaway regex when the vm timeout fires.

export const LOOP_MATCH_TIMEOUT_MS = 50
// Total characters judged per tick; output past this in one tick is skipped.
export const LOOP_MATCH_MAX_CHARS = 32_000
const MAX_LINE_CHARS = 500

const script = new Script(
  'var __re = new RegExp(pattern); var __hit = -1; for (var __i = 0; __i < lines.length; __i++) { if (__re.test(lines[__i])) { __hit = __i; break } } __hit'
)

export type LoopMatchResult =
  | { kind: 'match'; line: string }
  | { kind: 'none' }
  | { kind: 'timeout' }

/** Bounded lines: the newest output wins when a tick has more than the cap. */
export function boundLoopMatchLines(lines: readonly string[]): string[] {
  const out: string[] = []
  let total = 0
  for (let i = lines.length - 1; i >= 0 && total < LOOP_MATCH_MAX_CHARS; i -= 1) {
    const line = lines[i].slice(0, MAX_LINE_CHARS)
    total += line.length
    out.push(line)
  }
  return out.toReversed()
}

export function matchLoopPattern(
  pattern: string,
  lines: readonly string[],
  timeoutMs = LOOP_MATCH_TIMEOUT_MS
): LoopMatchResult {
  const bounded = boundLoopMatchLines(lines)
  // A fresh context per call: a timed-out run leaves nothing behind.
  const context = createContext({ pattern, lines: bounded })
  try {
    const hit = script.runInContext(context, { timeout: timeoutMs }) as number
    return hit >= 0 ? { kind: 'match', line: bounded[hit] } : { kind: 'none' }
  } catch (error) {
    // Why: the error is created in the vm's realm, so `instanceof Error` is false.
    if ((error as { code?: unknown } | null)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      return { kind: 'timeout' }
    }
    throw error
  }
}
