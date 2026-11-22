/* Connects bug-autofix.ts to the real store, settings, Pause crew gate and
 * runtime. Split out so the decision logic stays testable without Electron. */

import { basename } from 'node:path'

import { blockExecutionOrigin, checkExecutionAdmission } from '../agents/execution-gate'
import { readLeadConfig } from '../leads/lead-config'
import type { DobiusRuntimeService } from '../runtime/dobius-runtime'
import type { Store } from '../persistence'
import { buildBugFixStartup, BUG_FIX_AGENT } from './bug-autofix-claude-profile'
import { configureBugAutoFix, disposeBugAutoFix, type BugAutoFixWorktree } from './bug-autofix'
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
    isWorktreeLive: async (worktreeId) => {
      const { terminals } = await runtime.listTerminals(`id:${worktreeId}`)
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
      const { worktrees } = await runtime.listManagedWorktrees(repoId, 10_000)
      const match = (worktrees as WorktreeLike[]).find(
        (worktree) => basename(worktree.path) === name || worktree.displayName === name
      )
      return match ? toFound(match) : null
    },
    createWorktree: async ({ repoId, name, prompt, comment }) => {
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
