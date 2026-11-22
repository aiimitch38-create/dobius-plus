/* Connects bug-autofix.ts to the real store, settings, Pause crew gate and
 * runtime. Split out so the decision logic stays testable without Electron. */

import { checkExecutionAdmission } from '../agents/execution-gate'
import { readLeadConfig } from '../leads/lead-config'
import type { DobiusRuntimeService } from '../runtime/dobius-runtime'
import type { Store } from '../persistence'
import { isTuiAgent } from '../../shared/tui-agent-config'
import type { TuiAgent } from '../../shared/types'
import { configureBugAutoFix } from './bug-autofix'
import { vertexTaskStore } from './vertex-task-store'

function projectIdOf(repoPath: string): string | null {
  try {
    return readLeadConfig(repoPath).projectId
  } catch (error) {
    // Why: a broken lead.json must not hide the repo's identity forever, but
    // it also must not be guessed at; that repo simply does not match.
    console.warn(`[bug-autofix] skipped ${repoPath}:`, error)
    return null
  }
}

export function wireBugAutoFix(store: Store, runtime: DobiusRuntimeService): void {
  const fixAgent = (): TuiAgent => {
    const preferred = store.getSettings().defaultTuiAgent
    return isTuiAgent(preferred) ? preferred : 'claude'
  }
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
    agentName: fixAgent,
    createWorktree: async ({ repoId, name, prompt, comment }) => {
      const agent = fixAgent()
      const result = await runtime.createManagedWorktree({
        repoSelector: repoId,
        name,
        comment,
        startupAgent: agent,
        createdWithAgent: agent,
        startupPrompt: prompt,
        activate: false,
        // Why skip: this repo's setup script runs `pnpm install`, and a fix
        // agent must never install. The prompt links node_modules instead.
        setupDecision: 'skip',
        // Pause crew is re-checked right before the agent spawns.
        executionOrigin: 'bug-report'
      })
      return {
        worktreeId: result.worktree.id,
        worktreePath: result.worktree.path,
        branch: result.worktree.branch,
        warning: result.warning
      }
    }
  })
}
