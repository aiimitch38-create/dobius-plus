import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRunContext } from '../../shared/agents'
import { writeJsonFileAtomic } from '../storage/safe-json-file'
import type { AdamContextPack, ExecutionOrigin } from './execution-gate'

/** Where an admitted run can read the context it was admitted under, relative to its cwd. */
export const ADMITTED_CONTEXT_FILE = path.join('.dobius', 'context', 'current.json')
// Long enough to tell packs apart in a transcript, short enough for one line.
const BANNER_DIGEST_LENGTH = 15

export type AdmittedContextDelivery = {
  /** Merged OVER the run env by the caller; never carries anything but these keys. */
  env: Record<string, string>
  /** One line for the system prompt. */
  banner: string
  /** Absolute path of the written current.json, or undefined when the write failed. */
  filePath?: string
}

/**
 * The three surfaces that carry ADAM's admitted context pack (B2) to the agent
 * that was admitted: env vars, `.dobius/context/current.json` in the cwd, and a
 * prompt banner. Only the file can fail, and a failed file never fails the run.
 */
export function deliverAdmittedContext(args: {
  cwd: string
  pack: AdamContextPack
  context: AgentRunContext
  origin: ExecutionOrigin
  now?: number
}): AdmittedContextDelivery {
  const { projectId, digest } = args.pack
  const worktreeId = args.context.worktreeId
  const env: Record<string, string> = { DOBIUS_PROJECT_ID: projectId }
  if (digest) {
    env.DOBIUS_CONTEXT_DIGEST = digest
  }
  if (worktreeId) {
    env.DOBIUS_WORKTREE_ID = worktreeId
  }
  const banner = digest
    ? `Dobius context: project=${projectId} digest=${digest.slice(0, BANNER_DIGEST_LENGTH)}`
    : `Dobius context: project=${projectId}`
  const filePath = path.join(args.cwd, ADMITTED_CONTEXT_FILE)
  // Separate from the write below: an unwritable .gitignore must not cost the run its current.json.
  try {
    ensureDobiusDirIgnored(args.cwd)
  } catch (error) {
    console.warn(
      `[agents] could not add .dobius/ to ${path.join(args.cwd, '.gitignore')}:`,
      error instanceof Error ? error.message : String(error)
    )
  }
  try {
    writeJsonFileAtomic(filePath, {
      projectId,
      contextDigest: digest ?? null,
      worktree: worktreeId ?? null,
      origin: args.origin,
      admittedAt: new Date(args.now ?? Date.now()).toISOString()
    })
    return { env, banner, filePath }
  } catch (error) {
    // A read-only or vanished cwd must not stop an admitted run: the agent
    // still gets the env vars and the banner.
    console.warn(
      `[agents] could not write admitted context to ${filePath}:`,
      error instanceof Error ? error.message : String(error)
    )
    return { env, banner }
  }
}

/**
 * Appends the banner to the run's system prompt. An agent with no prompt of
 * its own keeps the default Claude Code prompt (a bare string would replace it).
 */
export function withContextBanner(
  systemPrompt: string,
  banner: string | undefined
): Options['systemPrompt'] {
  if (!banner) {
    return systemPrompt || undefined
  }
  if (!systemPrompt) {
    return { type: 'preset', preset: 'claude_code', append: banner }
  }
  return `${systemPrompt}\n\n${banner}`
}

// Only at a checkout root (`.git` present): a `.gitignore` conjured into some
// other folder would itself show up as untracked. Mirrors hooks.ts.
function ensureDobiusDirIgnored(cwd: string): void {
  if (!existsSync(path.join(cwd, '.git'))) {
    return
  }
  const gitignorePath = path.join(cwd, '.gitignore')
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '.dobius/\n', 'utf-8')
    return
  }
  const content = readFileSync(gitignorePath, 'utf-8')
  if (/^\.dobius\/?$/m.test(content)) {
    return
  }
  const separator = content.endsWith('\n') || content === '' ? '' : '\n'
  writeFileSync(gitignorePath, `${content}${separator}.dobius/\n`, 'utf-8')
}
