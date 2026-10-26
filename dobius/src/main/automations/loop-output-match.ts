import type {
  Automation,
  AutomationLoop,
  AutomationLoopState
} from '../../shared/automations-types'
import { admitOutputMatch, validateLoopPattern } from '../../shared/automation-loops'
import { matchLoopPattern } from './loop-pattern-match'
import type { LoopTerminals } from './loop-terminals'

// "When output contains…" loops. Each watched console keeps its own read cursor
// and cooldown, and only the consoles whose new output matched are told. Why:
// "the moment a console prints FAILED, that agent fixes it" must not nudge the
// agents that are fine.

export type OutputMatchHost = {
  /** Delivers one run to `onlyTabIds` (the runner's normal fire path). */
  fire: (
    automation: Automation,
    loop: AutomationLoop,
    now: number,
    instruction: string,
    baseState: AutomationLoopState,
    onlyTabIds: readonly string[]
  ) => Promise<unknown>
  saveState: (automation: Automation, loop: AutomationLoop, state: AutomationLoopState) => void
  resolveTabIds: (loop: AutomationLoop) => string[]
  /** Disables the loop and records why (a pattern that blew its time budget). */
  pause: (automation: Automation, loop: AutomationLoop, state: AutomationLoopState) => void
}

/**
 * Per-tab read cursors. A loop saved before multi-console output match kept one
 * cursor for its single tab; carry it over so old scrollback is never re-judged.
 */
export function outputCursorsOf(loop: AutomationLoop): Record<string, string> {
  if (loop.state.outputCursors) {
    return { ...loop.state.outputCursors }
  }
  const { trigger, state } = loop
  return trigger.kind === 'on-output-match' &&
    trigger.target.type === 'tab' &&
    state.outputCursor !== null
    ? { [trigger.target.tabId]: state.outputCursor }
    : {}
}

export async function tickOutputMatch(
  host: OutputMatchHost,
  terminals: LoopTerminals,
  automation: Automation,
  loop: AutomationLoop,
  now: number
): Promise<void> {
  if (loop.trigger.kind !== 'on-output-match' || !validateLoopPattern(loop.trigger.pattern).ok) {
    return
  }
  const { pattern, cooldownMs } = loop.trigger
  const cursors = outputCursorsOf(loop)
  const firedAt = { ...loop.state.firedAtByTab }
  let moved = false
  const matched: string[] = []
  for (const tabId of host.resolveTabIds(loop)) {
    const cursor = cursors[tabId] ?? null
    const read = await terminals.read(tabId, cursor)
    if (!read) {
      continue
    }
    const hadCursor = cursor !== null
    const match = hadCursor ? matchLoopPattern(pattern, read.lines) : ({ kind: 'none' } as const)
    // Why: the cursor always moves past what was just judged, fire or not, so
    // the same output range can never fire twice.
    if (read.cursor !== null && read.cursor !== cursor) {
      cursors[tabId] = read.cursor
      moved = true
    }
    if (match.kind === 'timeout') {
      // A pattern that blew its time budget would do it again every tick: stop the loop.
      host.pause(automation, loop, {
        ...loop.state,
        outputCursors: cursors,
        lastResult: 'Pattern took too long to match; loop paused.'
      })
      return
    }
    const decision = admitOutputMatch({
      state: { ...loop.state, lastFiredAt: firedAt[tabId] ?? null },
      hadCursor,
      matched: match.kind === 'match',
      now,
      cooldownMs
    })
    if (decision.fire) {
      matched.push(tabId)
      firedAt[tabId] = now
    }
  }
  const advanced: AutomationLoopState = { ...loop.state, outputCursors: cursors }
  if (matched.length === 0) {
    if (moved) {
      host.saveState(automation, loop, advanced)
    }
    return
  }
  // Why: never echo terminal output back into a terminal; only the user's own
  // instruction is delivered.
  await host.fire(
    automation,
    loop,
    now,
    automation.prompt,
    { ...advanced, firedAtByTab: firedAt },
    matched
  )
}
