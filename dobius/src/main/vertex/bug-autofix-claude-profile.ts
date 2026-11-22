/* The restricted launch profile for bug auto-fix agents.
 *
 * Fix agents always run Claude Code, never Codex or another TUI: these are
 * Claude CLI flags (checked against `claude --help`, 2.1.325):
 *   --permission-mode acceptEdits  file edits auto-accepted; any Bash not
 *                                  pre-allowed below asks Carson in the console
 *   --allowedTools <tools...>      the verify-and-commit loop runs unattended
 *   --disallowedTools <tools...>   deny rules; in Claude Code a deny always
 *                                  beats an allow, including Carson's settings
 * Never --dangerously-skip-permissions or --allow-dangerously-skip-permissions,
 * and Carson's per-agent default args and command overrides are not used.
 *
 * Why --permission-mode is last: the tool flags are variadic, so a plain
 * option has to end their lists before the prompt argument. */

import { buildAgentStartupPlan } from '../../shared/tui-agent-startup'
import type { TuiAgent, WorktreeStartupLaunch } from '../../shared/types'

export const BUG_FIX_AGENT: TuiAgent = 'claude'

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
  'Read(**/dobius-runtime.json)',
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
  'Bash(git commit *)',
]

function quoted(tools: readonly string[]): string {
  return tools.map((tool) => `"${tool}"`).join(' ')
}

export const BUG_FIX_CLAUDE_ARGS = [
  `--disallowedTools ${quoted(BUG_FIX_DENIED_TOOLS)}`,
  `--allowedTools ${quoted(BUG_FIX_ALLOWED_TOOLS)}`,
  '--permission-mode acceptEdits',
].join(' ')

export function buildBugFixStartup(prompt: string): WorktreeStartupLaunch {
  const plan = buildAgentStartupPlan({
    agent: BUG_FIX_AGENT,
    prompt,
    cmdOverrides: {},
    agentArgs: BUG_FIX_CLAUDE_ARGS,
    agentEnv: {},
    platform: process.platform,
  })
  if (!plan) {
    throw new Error('Could not build the fix agent launch command.')
  }
  return {
    command: plan.launchCommand,
    launchConfig: plan.launchConfig,
    launchAgent: BUG_FIX_AGENT,
    ...(plan.startupCommandDelivery ? { startupCommandDelivery: plan.startupCommandDelivery } : {}),
    ...(plan.env ? { env: plan.env } : {}),
  }
}
