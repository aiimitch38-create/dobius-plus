import { READINESS_LABELS } from '../capabilities/registry.js'

const READ_ONLY_VERIFIED = READINESS_LABELS.indexOf('read_only_verified')
const APPROVAL_GATED_LIVE = READINESS_LABELS.indexOf('approval_gated_live')

export const RESTRICTED_TOOL_POLICY =
  'TOOL POLICY (enforced): local read/edit/test tools only. No network-write verbs and no outward actions of any kind: do not push, merge, deploy, release, publish, purchase, spend money, or contact external people.'

export const APPROVAL_GATED_TOOL_POLICY =
  'TOOL POLICY (approval-gated): broader local tools are permitted, but every outward action (push, merge, deploy, release, publish, spend, message a person, external API write) must route through the ADAM approval flow first; propose the action and wait for an approved digest before executing it.'

export type ToolPolicyTier = 'restricted' | 'approval_gated'

export type ToolPolicy = { tier: ToolPolicyTier; policy: string }

export function toolPolicyForLevel(level: unknown): ToolPolicy {
  if (
    typeof level !== 'number' || !Number.isInteger(level) ||
    level < 0 || level >= READINESS_LABELS.length
  ) {
    throw new Error(`Unknown readiness level (${String(level)}); refusing to derive a tool policy`)
  }
  if (level < READ_ONLY_VERIFIED) {
    throw new Error(`Readiness level ${level} (${String(READINESS_LABELS[level])}) is below read_only_verified; worker launch refused`)
  }
  if (level < APPROVAL_GATED_LIVE) return { tier: 'restricted', policy: RESTRICTED_TOOL_POLICY }
  return { tier: 'approval_gated', policy: APPROVAL_GATED_TOOL_POLICY }
}

export function resolveLaunchToolPolicy(level: unknown): string {
  if (level === undefined) return RESTRICTED_TOOL_POLICY
  return toolPolicyForLevel(level).policy
}
