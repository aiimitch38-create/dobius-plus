/* Connects bug-autofix.ts to the real store, settings, Pause crew gate and
 * runtime. Split out so the decision logic stays testable without Electron. */

import { basename } from 'node:path'

import { blockExecutionOrigin, checkExecutionAdmission } from '../agents/execution-gate'
import { readLeadConfig } from '../leads/lead-config'
import type { DobiusRuntimeService } from '../runtime/dobius-runtime'
import type { Store } from '../persistence'
import { buildBugFixStartup, BUG_FIX_AGENT } from './bug-autofix-claude-profile'
import { configureBugAutoFix, disposeBugAutoFix, type BugAutoFixWorktree } from './bug-autofix'
import { isSafeAttachmentId, vertexTaskAttachmentDir } from './vertex-attachment-paths'
import { vertexTaskStore } from './vertex-task-store'

function projectIdOf(repoPath: string): string | null {
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

function toFound(worktree: WorktreeLike): BugAutoFixWorktree {
  return { worktreeId: worktree.id, worktreePath: worktree.path, branch: worktree.branch }
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
    findWorktree: async (repoId, name) => {
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
    },
    createWorktree: async ({ repoId, name, prompt, comment, taskId, hasAttachments }) => {
      // Why: --restricted confines file tools to the workspace; the card's own
      // screenshot folder is the one extra place the agent may read.
      const addDirs =
        hasAttachments && isSafeAttachmentId(taskId) ? [vertexTaskAttachmentDir(taskId)] : []
      const result = await runtime.createManagedWorktree({
        repoSelector: repoId,
        name,
        comment,
        // Why an explicit startup: the normal launch uses Carson's default args,
        // which include --dangerously-skip-permissions. See the profile file.
        startup: buildBugFixStartup(prompt, addDirs),
        createdWithAgent: BUG_FIX_AGENT,
        activate: false,
        // Why skip: this repo's setup script runs `pnpm install`, and a fix
        // agent must never install. The prompt links node_modules instead.
        setupDecision: 'skip',
        // Pause crew is re-checked right before the agent spawns.
        executionOrigin: 'bug-report'
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
