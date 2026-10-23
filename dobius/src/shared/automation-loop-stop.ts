import type { AutomationLoop, AutomationLoopState } from './automation-loop-types'

// Stop rules for Board loops beyond the time limit: a run-count cap and a
// "stop once this command passes" check. Pure; main runs the check, the
// renderer validates the form with the same rules.

export const LOOP_STOP_COMMAND_MAX_LENGTH = 200
/** The check never runs sooner than this after a run, so the agent has started. */
export const LOOP_STOP_CHECK_MIN_DELAY_MS = 30_000
/** Checked even if the console still reports "working" this long after a run. */
export const LOOP_STOP_CHECK_MAX_DELAY_MS = 15 * 60_000
export const LOOP_STOP_CHECK_TIMEOUT_SECONDS = 600
export const LOOP_STOP_RUNS_LIMIT = 500

/** The run-count and command stops of a persisted loop; invalid values are dropped. */
export function normalizeLoopStopFields(raw: Record<string, unknown>): {
  stopAfterRuns?: number
  stopCommand?: string
} {
  const runs =
    typeof raw.stopAfterRuns === 'number' && Number.isFinite(raw.stopAfterRuns)
      ? Math.min(LOOP_STOP_RUNS_LIMIT, Math.round(raw.stopAfterRuns))
      : 0
  const command = typeof raw.stopCommand === 'string' ? raw.stopCommand.trim() : ''
  return {
    ...(runs > 0 ? { stopAfterRuns: runs } : {}),
    ...(command && command.length <= LOOP_STOP_COMMAND_MAX_LENGTH ? { stopCommand: command } : {})
  }
}

export type StopCommandProblem = 'empty' | 'too_long' | 'shell' | 'destructive'

// Why: the check runs unattended in the user's worktree, so it may only be a
// single plain command: no chaining, pipes, redirects, substitution, and no
// quoting, globbing, tilde, history or comments. Without quotes or escapes the
// shell passes every word through literally, so the word checks below cannot
// be dodged by writing 'rm' or r"m" (the shell would strip those quotes).
const SHELL_META = /[;|&<>`$\\\n\r(){}'"*?[\]~!#]/
// ... that is not a known way to delete, move, publish, install or rewrite,
// and not an interpreter that could run arbitrary code (bash -c, node -e ...).
const DESTRUCTIVE_WORDS =
  /(^|[\s/])(rm|rmdir|rimraf|trash|unlink|shred|truncate|dd|mkfs\S*|mv|cp|ln|tee|chmod|chown|chgrp|sudo|su|doas|kill|killall|pkill|shutdown|reboot|halt|curl|wget|ssh|scp|rsync|ftp|xargs|eval|env|command|builtin|source|osascript|open|nohup|sh|bash|zsh|fish|dash|ksh|csh|tcsh|python\d*(\.\d+)?|node|deno|bun|perl[0-9.]*|ruby[0-9.]*|php[0-9.]*|lua[0-9.]*|tar|tclsh|awk|gawk|sed|find)(\s|$)/i
const DESTRUCTIVE_SUBCOMMANDS =
  /(^|\s)(publish|deploy|release|install|i|uninstall|add|remove|upgrade|update|prune|link|push|reset|clean|checkout|switch|restore|rebase|merge|commit|stash|tag|apply|cherry-pick|revert|branch|worktree|clone|pull|fetch|gc|delete)(\s|$)/i
const DESTRUCTIVE_FLAGS =
  /(^|\s)(-delete|--delete|--force|--fix|--write|--yolo|--dangerously\S*|--no-verify)(\s|=|$)/i

export function stopCommandProblem(command: string): StopCommandProblem | null {
  const c = command.trim()
  if (!c) {
    return 'empty'
  }
  if (c.length > LOOP_STOP_COMMAND_MAX_LENGTH) {
    return 'too_long'
  }
  if (SHELL_META.test(c)) {
    return 'shell'
  }
  if (DESTRUCTIVE_WORDS.test(c) || DESTRUCTIVE_SUBCOMMANDS.test(c) || DESTRUCTIVE_FLAGS.test(c)) {
    return 'destructive'
  }
  return null
}

/**
 * Whether the pending stop check should run now: a run happened at
 * `pendingSince`, the minimum delay passed, and the target consoles are no
 * longer working (or the maximum delay passed anyway).
 */
export function stopCheckDue(input: {
  pendingSince: number | null | undefined
  now: number
  targetsWorking: boolean
}): boolean {
  const { pendingSince, now } = input
  if (pendingSince === null || pendingSince === undefined) {
    return false
  }
  const waited = now - pendingSince
  return (
    waited >= LOOP_STOP_CHECK_MAX_DELAY_MS ||
    (waited >= LOOP_STOP_CHECK_MIN_DELAY_MS && !input.targetsWorking)
  )
}

/** True when a loop with a run-count stop has used all its runs. */
export function runsExhausted(stopAfterRuns: number | undefined, runCount: number): boolean {
  return stopAfterRuns !== undefined && runCount >= stopAfterRuns
}

/**
 * State changes after a delivered run: retire when the run cap is reached, and
 * owe one stop check (run once the agent is done) when there is a stop command.
 */
export function stopStateAfterRun(
  loop: Pick<AutomationLoop, 'stopAfterRuns' | 'stopCommand'>,
  runCount: number,
  now: number,
  lastResult: string | null
): Partial<AutomationLoopState> {
  const outOfRuns = runsExhausted(loop.stopAfterRuns, runCount)
  return {
    ...(outOfRuns
      ? { retiredAt: now, lastResult: `${lastResult ?? ''} Stopped after ${runCount} runs.`.trim() }
      : {}),
    ...(loop.stopCommand ? { stopCheckSince: now } : {})
  }
}
