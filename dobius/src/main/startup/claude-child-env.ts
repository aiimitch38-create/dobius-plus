// Claude Code marks every command its Bash tool runs with these variables. A
// Dobius started from inside a Claude session (a dev run, or Claude restarting
// the app by running its binary) inherits them, and every tab after that
// starts Claude as a "child session": it shows "Transcript saving is off,
// inherited CLAUDE_CODE_CHILD_SESSION marker" and writes no transcript, so
// resume, History and the Chat view cannot find the conversation. A tab is a
// new top-level session, never a child of whatever launched the app, so main
// drops them from its own environment at startup; every PTY, the forked
// daemon and helper processes then start clean. Ported from Line A #26.
// The person's own CLAUDE_CONFIG_DIR, CLAUDE_CODE_SKIP_PROMPT_HISTORY and
// CLAUDE_CODE_FORCE_SESSION_PERSISTENCE choices stay.
export const CLAUDE_CHILD_SESSION_MARKERS = Object.freeze([
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ATTENDED'
] as const)

/** Removes the markers from `env` in place; returns the names that were set. */
export function dropInheritedClaudeChildMarkers(env: NodeJS.ProcessEnv = process.env): string[] {
  const dropped: string[] = []
  for (const name of CLAUDE_CHILD_SESSION_MARKERS) {
    // Why: presence matters, not the value; an empty marker still flags a child.
    if (Object.hasOwn(env, name)) {
      dropped.push(name)
      delete env[name]
    }
  }
  return dropped
}
