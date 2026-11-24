/* Connects bug-autofix.ts to the real store, settings, Pause crew gate and
 * runtime. Split out so the decision logic stays testable without Electron. */

import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, join, sep } from 'node:path'

import { blockExecutionOrigin, checkExecutionAdmission } from '../agents/execution-gate'
import { readLeadConfig } from '../leads/lead-config'
import type { DobiusRuntimeService } from '../runtime/dobius-runtime'
import type { Store } from '../persistence'
import { buildBugFixStartup, BUG_FIX_AGENT } from './bug-autofix-claude-profile'
import { configureBugAutoFix, disposeBugAutoFix, type BugAutoFixWorktree } from './bug-autofix'
import { BUG_FIX_EVIDENCE_DIR } from '../../shared/bug-fix-agent-profile'
import { isInsideAttachmentsRoot, vertexAttachmentsRoot } from './vertex-attachment-paths'
import { vertexTaskStore } from './vertex-task-store'

export function projectIdOf(repoPath: string): string | null {
  try {
    return readLeadConfig(repoPath).projectId
  } catch (error) {
    // Why: a broken lead.json must not be guessed at; that repo does not match.
    console.warn(`[bug-autofix] skipped ${repoPath}:`, error)
    return null
  }
}

const LIVENESS_TERMINAL_LIMIT = 100

type WorktreeLike = { id: string; path: string; branch?: string; displayName?: string }

export function toFound(worktree: WorktreeLike): BugAutoFixWorktree {
  return { worktreeId: worktree.id, worktreePath: worktree.path, branch: worktree.branch }
}

/** The managed workspace with this folder name: null only when git answered
 *  that it does not exist, 'unknown' when the list could not be read. */
export async function findManagedWorktreeByName(
  runtime: DobiusRuntimeService,
  repoId: string,
  name: string
): Promise<BugAutoFixWorktree | null | 'unknown'> {
  let listed: Awaited<ReturnType<DobiusRuntimeService['listDetectedManagedWorktrees']>>
  try {
    // Why this scan: it says whether git answered (authoritative) or it
    // fell back to metadata; the cached list turns a scan timeout into [].
    listed = await runtime.listDetectedManagedWorktrees(repoId)
  } catch (error) {
    console.warn('[bug-autofix] workspace list unavailable:', error)
    return 'unknown'
  }
  const match = (listed.worktrees as WorktreeLike[]).find(
    (worktree) => basename(worktree.path) === name || worktree.displayName === name
  )
  if (match) {
    return toFound(match)
  }
  return listed.authoritative ? null : 'unknown'
}

/** Copies the card's screenshots into the new workspace, so the agent works
 *  on copies and the original evidence stays out of its reach. The folder
 *  ignores itself, so the copies are never committed. */
export function copyBugEvidence(screenshots: readonly string[], worktreePath: string): void {
  // Why realpath + lstat: a symlink under the attachments root must not
  // expose another file, and only regular files are evidence.
  const root = realpathSync(vertexAttachmentsRoot())
  const sources = screenshots.filter((source) => {
    try {
      return (
        isInsideAttachmentsRoot(source) &&
        lstatSync(source).isFile() &&
        realpathSync(source).startsWith(root + sep)
      )
    } catch {
      return false
    }
  })
  if (sources.length === 0) {
    return
  }
  // Why: the checkout is repo content; a committed symlink at .dobius or
  // bug-report must not redirect these writes outside the workspace.
  const workspace = realpathSync(worktreePath)
  let dir = workspace
  for (const part of BUG_FIX_EVIDENCE_DIR.split('/')) {
    dir = join(dir, part)
    if (!existsSync(dir)) {
      mkdirSync(dir)
    } else if (!lstatSync(dir).isDirectory()) {
      throw new Error(`Bug evidence folder ${dir} is a link or a file.`)
    }
  }
  if (realpathSync(dir) !== dir) {
    throw new Error('Bug evidence folder is not a plain folder inside the workspace.')
  }
  // Why the exclusive flags: an existing file (or symlink) is never overwritten.
  writeFileSync(join(dir, '.gitignore'), '*\n', { flag: 'wx' })
  for (const source of sources) {
    copyFileSync(source, join(dir, basename(source)), constants.COPYFILE_EXCL)
  }
}

export function wireBugAutoFix(store: Store, runtime: DobiusRuntimeService): void {
  configureBugAutoFix({
    listTasks: () => vertexTaskStore.list(),
    updateTask: (taskId, patch) => vertexTaskStore.update(taskId, patch),
    isEnabled: () => store.getSettings().bugAutoFixEnabled !== false,
    admission: () => checkExecutionAdmission('bug-report'),
    findRepos: (projectId) =>
      runtime
        .listRepos()
        .filter((repo) => projectIdOf(repo.path) === projectId)
        .map((repo) => ({ id: repo.id, name: repo.displayName || repo.id, path: repo.path })),
    agentName: () => BUG_FIX_AGENT,
    // Why: the fix agent's launch quoting is POSIX; a Windows PTY may fall
    // back to cmd.exe, where the restricted flags would not parse as intended.
    unsupportedReason: () =>
      process.platform === 'win32' ? 'Auto-fix is not available on Windows yet.' : null,
    isWorktreeLive: async (worktreeId) => {
      // Why fresh liveness: after a restart the cache can miss daemon terminals,
      // and a missed agent would free its slot early.
      const { terminals, truncated } = await runtime.listTerminals(
        `id:${worktreeId}`,
        LIVENESS_TERMINAL_LIMIT,
        { requireFreshPtyLiveness: true }
      )
      if (truncated) {
        return true
      }
      for (const terminal of terminals) {
        if (
          terminal.connected &&
          (await runtime.getTerminalAgentStatus(terminal.handle)).isRunningAgent
        ) {
          return true
        }
      }
      return false
    },
    findWorktree: (repoId, name) => findManagedWorktreeByName(runtime, repoId, name),
    createWorktree: async ({ repoId, name, prompt, comment, screenshots }) => {
      const result = await runtime.createManagedWorktree({
        repoSelector: repoId,
        name,
        comment,
        // Why an explicit startup: the normal launch uses Carson's default args,
        // which include --dangerously-skip-permissions. See the profile file.
        startup: buildBugFixStartup(prompt),
        createdWithAgent: BUG_FIX_AGENT,
        activate: false,
        // Why skip: this repo's setup script runs `pnpm install`, and a fix
        // agent must never install. The prompt links node_modules instead.
        setupDecision: 'skip',
        // Pause crew is re-checked right before the agent spawns.
        executionOrigin: 'bug-report',
        prepareWorkspace: (worktreePath) => {
          try {
            copyBugEvidence(screenshots, worktreePath)
          } catch (error) {
            // Why: missing screenshots must not block the fix; the agent says so.
            console.warn('[bug-autofix] could not copy screenshots:', error)
          }
        }
      })
      return { ...toFound(result.worktree), warning: result.warning }
    }
  })
}

/** App quit: stop pumping, and refuse any fix whose workspace is still being made. */
export function shutdownBugAutoFix(): void {
  blockExecutionOrigin('bug-report')
  disposeBugAutoFix()
}
