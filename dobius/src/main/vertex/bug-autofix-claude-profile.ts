/* Builds the fix agent's first launch from the shared restricted profile
 * (shared/bug-fix-agent-profile.ts, where every flag is explained). Carson's
 * per-agent default args, env and command overrides are deliberately unused. */

import { bugFixClaudeArgs } from '../../shared/bug-fix-agent-profile'
import { buildAgentStartupPlan } from '../../shared/tui-agent-startup'
import type { TuiAgent, WorktreeStartupLaunch } from '../../shared/types'

export {
  BUG_FIX_ALLOWED_TOOLS,
  BUG_FIX_DENIED_TOOLS,
  BUG_FIX_TOOLS
} from '../../shared/bug-fix-agent-profile'

export const BUG_FIX_AGENT: TuiAgent = 'claude'

export function buildBugFixStartup(prompt: string): WorktreeStartupLaunch {
  const plan = buildAgentStartupPlan({
    agent: BUG_FIX_AGENT,
    prompt,
    cmdOverrides: {},
    agentArgs: bugFixClaudeArgs(),
    agentEnv: {},
    platform: process.platform
  })
  if (!plan) {
    throw new Error('Could not build the fix agent launch command.')
  }
  return {
    command: plan.launchCommand,
    launchConfig: plan.launchConfig,
    launchAgent: BUG_FIX_AGENT,
    ...(plan.startupCommandDelivery ? { startupCommandDelivery: plan.startupCommandDelivery } : {}),
    ...(plan.env ? { env: plan.env } : {})
  }
}
