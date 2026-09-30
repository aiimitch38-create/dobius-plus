import {
  GIT_CONFIG_WRITE_REASON,
  isForcePush,
  isUnverifiablePush,
  UNVERIFIABLE_PUSH_REASON,
  writesPushRewritingGitConfig
} from './agent-hard-rails-git'

const DOBIUS_CLI_AT_COMMAND_START =
  /(?:^|[;&|()`])\s*(?:(?:env|command|exec|nohup|sudo)\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*["']?(?:[^\s;&|()`"']+\/)?dobius["']?(?=\s|$)/

export function commandHardRailDenial(toolName: string, input: unknown): { reason: string } | null {
  if (toolName !== 'Bash' || typeof input !== 'object' || input === null) {
    return null
  }
  const command = (input as { command?: unknown }).command
  if (typeof command !== 'string') {
    return null
  }
  if (DOBIUS_CLI_AT_COMMAND_START.test(command)) {
    return { reason: 'Hard rail: the unrestricted Dobius CLI is not available to agent runs.' }
  }
  if (isForcePush(command)) {
    return { reason: 'Hard rail: force-pushing is not allowed from agent runs.' }
  }
  if (isUnverifiablePush(command)) {
    return { reason: UNVERIFIABLE_PUSH_REASON }
  }
  if (writesPushRewritingGitConfig(command)) {
    return { reason: GIT_CONFIG_WRITE_REASON }
  }
  if (/\brm\s+(?:-[^\s]*r[^\s]*f|-+[^\s]*f[^\s]*r)\s+(?:--\s+)?\/(?:\*|\s|$)/.test(command)) {
    return { reason: 'Hard rail: recursive root deletes are not allowed from agent runs.' }
  }
  return null
}
