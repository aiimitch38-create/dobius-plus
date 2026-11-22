/* The restricted launch profile for bug auto-fix agents. Shared so main
 * (first launch) and the renderer (console Restart) build the same command;
 * a restart must never fall back to the Settings defaults, which carry
 * --dangerously-skip-permissions.
 *
 * Fix agents always run Claude Code, never Codex or another TUI: these are
 * Claude CLI flags (checked against `claude --help`, 2.1.325):
 *   --restricted                   ignores user, project and local settings
 *                                  files, so no inherited allow rule, hook or
 *                                  defaultMode widens this profile; confines
 *                                  file tools to the workspace (plus --add-dir)
 *                                  and refuses bypassPermissions
 *   --strict-mcp-config            with no --mcp-config: no MCP servers at all
 *   --tools <tools...>             the only built-in tools; --restricted drops
 *                                  Bash unless it is named here
 *   --add-dir <directories...>     only the card's own screenshot folder
 *   --disallowedTools <tools...>   deny rules; a deny always beats an allow
 *   --allowedTools <tools...>      the verify-and-commit loop runs unattended
 *   --permission-mode acceptEdits  file edits auto-accepted; any Bash not
 *                                  pre-allowed asks Carson in the console
 * Never --dangerously-skip-permissions or --allow-dangerously-skip-permissions.
 *
 * Why --permission-mode is last: the other flags are variadic, so a plain
 * option has to end their lists before the prompt argument. */

export const BUG_FIX_PROFILE_FLAG = '--restricted'

/** Worktree folder names start with this (see bugFixWorktreeName in main). */
export const BUG_FIX_WORKTREE_PREFIX = 'autofix-'

export const BUG_FIX_TOOLS: readonly string[] = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep']

export const BUG_FIX_DENIED_TOOLS: readonly string[] = [
  'Bash(git push*)',
  'Bash(git remote*)',
  'Bash(git commit --no-verify*)',
  'Bash(git commit -n*)',
  'Bash(*--no-verify*)',
  'Bash(gh *)',
  'Bash(pnpm install*)',
  'Bash(pnpm i *)',
  'Bash(pnpm add*)',
  'Bash(pnpm run build:cli*)',
  'Bash(pnpm build:cli*)',
  'Bash(npm install*)',
  'Bash(npm i *)',
  'Bash(npm ci*)',
  'Bash(yarn*)',
  'Bash(bun add*)',
  'Bash(bun install*)',
  'Bash(*build-and-install*)',
  'Bash(*install-dobius*)',
  'Bash(rm -rf*)',
  'Bash(rm -fr*)',
  'Bash(sudo *)',
  'Read(**/.env*)',
  'Read(**/dobius-runtime.json)'
]

export const BUG_FIX_ALLOWED_TOOLS: readonly string[] = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(pnpm run typecheck:node)',
  'Bash(pnpm run typecheck:web)',
  'Bash(pnpm run typecheck:cli)',
  'Bash(npx vitest run *)',
  'Bash(git status*)',
  'Bash(git diff*)',
  'Bash(git log*)',
  'Bash(git show*)',
  'Bash(git add *)',
  'Bash(git commit *)'
]

function quoted(values: readonly string[]): string {
  return values.map((value) => `"${value.replace(/["\\]/g, '\\$&')}"`).join(' ')
}

/** The Claude args for a fix agent; `addDirs` are extra read folders. */
export function bugFixClaudeArgs(addDirs: readonly string[] = []): string {
  return [
    BUG_FIX_PROFILE_FLAG,
    '--strict-mcp-config',
    `--tools ${quoted([BUG_FIX_TOOLS.join(',')])}`,
    ...(addDirs.length ? [`--add-dir ${quoted(addDirs)}`] : []),
    `--disallowedTools ${quoted(BUG_FIX_DENIED_TOOLS)}`,
    `--allowedTools ${quoted(BUG_FIX_ALLOWED_TOOLS)}`,
    '--permission-mode acceptEdits'
  ].join(' ')
}

/** True when a launch command or args string carries the restricted profile. */
export function isBugFixProfileLaunch(commandOrArgs: string | null | undefined): boolean {
  return /(^|\s)['"]?--restricted['"]?(?=\s|$)/.test(commandOrArgs ?? '')
}

/** True for a fix agent's workspace folder. The folder name never changes,
 *  unlike a display name or comment, so a restart can always recognise it. */
export function isBugFixWorktreePath(worktreePath: string | null | undefined): boolean {
  const name = (worktreePath ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  return name.startsWith(BUG_FIX_WORKTREE_PREFIX)
}
