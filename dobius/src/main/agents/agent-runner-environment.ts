import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { applyClaudeEnvPatch } from '../claude-accounts/environment'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'

function cloneProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  return env
}

export function buildRunEnv(preparation: ClaudeRuntimeAuthPreparation): Options['env'] {
  return applyClaudeEnvPatch(cloneProcessEnv(), preparation.envPatch, {
    stripAuthEnv: preparation.stripAuthEnv
  })
}

export function resolveAgentRunCwd(cwd: string): string {
  return ensureRunCwd(resolveRunCwdPath(cwd))
}

function resolveRunCwdPath(cwd: string): string {
  if (!cwd) {
    return os.homedir()
  }
  if (cwd === '~') {
    return os.homedir()
  }
  if (cwd.startsWith('~/') || cwd.startsWith('~\\')) {
    return path.join(os.homedir(), cwd.slice(2))
  }
  return path.resolve(cwd)
}

// An agent can be configured with a folder that does not exist yet (agents
// created from Communications default to a fresh per-agent workspace) — a
// missing cwd would make the CLI spawn fail, so create it instead.
function ensureRunCwd(resolved: string): string {
  try {
    mkdirSync(resolved, { recursive: true })
    return resolved
  } catch {
    return os.homedir()
  }
}

export function currentGitBranch(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      return undefined
    }
    console.warn(
      '[agents] failed to read git branch:',
      error instanceof Error ? error.message : String(error)
    )
    return undefined
  }
}
