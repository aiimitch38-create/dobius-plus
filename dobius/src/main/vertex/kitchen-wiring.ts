/* Connects kitchen.ts to the real store, settings, Pause crew gate and
 * runtime, reusing the bug auto-fix launch (restricted Claude profile, own
 * worktree, no setup script). Split out so the loop stays testable. */

import { blockExecutionOrigin, checkExecutionAdmission } from '../agents/execution-gate'
import type { Store } from '../persistence'
import type { DobiusRuntimeService } from '../runtime/dobius-runtime'
import { buildBugFixStartup, BUG_FIX_AGENT } from './bug-autofix-claude-profile'
import { findManagedWorktreeByName, projectIdOf, toFound } from './bug-autofix-wiring'
import {
  configureKitchen,
  disposeKitchen,
  KITCHEN_DEFAULT_MAX_MINUTES,
  type KitchenCookStatus
} from './kitchen'
import { reportKitchenNotice } from './kitchen-notice'
import { vertexTaskStore } from './vertex-task-store'

const TERMINAL_LIMIT = 100

type CookRuntime = Pick<DobiusRuntimeService, 'listTerminals' | 'getTerminalAgentStatus'>

/** A cook's state from the agent status hook and last-output time alone;
 *  the terminal's text is never read. */
export async function readCookStatus(
  runtime: CookRuntime,
  worktreeId: string
): Promise<KitchenCookStatus> {
  const { terminals, truncated } = await runtime.listTerminals(`id:${worktreeId}`, TERMINAL_LIMIT, {
    requireFreshPtyLiveness: true
  })
  if (truncated) {
    throw new Error('Too many terminals to tell which one is the cook.')
  }
  let state: KitchenCookStatus['state'] = 'gone'
  let lastOutputAt: number | null = null
  for (const terminal of terminals) {
    if (!terminal.connected) {
      continue
    }
    const agent = await runtime.getTerminalAgentStatus(terminal.handle)
    if (!agent.isRunningAgent) {
      continue
    }
    lastOutputAt = Math.max(lastOutputAt ?? 0, terminal.lastOutputAt ?? 0) || null
    if (agent.status === 'permission') {
      state = 'permission'
    } else if (agent.status === 'idle') {
      state = state === 'gone' ? 'idle' : state
    } else if (state !== 'permission') {
      // Why an unknown status counts as working: only a reported idle is a finish.
      state = 'working'
    }
  }
  return { state, lastOutputAt }
}

export function wireKitchen(store: Store, runtime: DobiusRuntimeService): void {
  configureKitchen({
    listTasks: () => vertexTaskStore.list(),
    updateTask: (taskId, patch) => vertexTaskStore.update(taskId, patch),
    // Why === true: off unless Carson turned it on.
    isEnabled: () => store.getSettings().kitchenEnabled === true,
    maxMinutes: () => store.getSettings().kitchenMaxMinutes ?? KITCHEN_DEFAULT_MAX_MINUTES,
    admission: () => checkExecutionAdmission('kitchen'),
    findRepos: (projectId) =>
      runtime
        .listRepos()
        .filter((repo) => projectIdOf(repo.path) === projectId)
        .map((repo) => ({ id: repo.id, name: repo.displayName || repo.id, path: repo.path })),
    // Why: the restricted launch quoting is POSIX (see bug-autofix-wiring.ts).
    unsupportedReason: () =>
      process.platform === 'win32' ? 'The kitchen is not available on Windows yet.' : null,
    cookStatus: (worktreeId) => readCookStatus(runtime, worktreeId),
    stopCook: async (worktreeId) => {
      await runtime.stopTerminalsForWorktree(`id:${worktreeId}`)
    },
    restartCook: async ({ worktreeId, prompt }) => {
      await runtime.stopTerminalsForWorktree(`id:${worktreeId}`)
      const startup = buildBugFixStartup(prompt)
      await runtime.createTerminal(`id:${worktreeId}`, {
        // Pause crew is re-checked right before the agent spawns.
        executionOrigin: 'kitchen',
        command: startup.command,
        env: startup.env,
        ...(startup.launchConfig ? { launchConfig: startup.launchConfig } : {}),
        launchAgent: BUG_FIX_AGENT,
        startupCommandDelivery: startup.startupCommandDelivery
      })
    },
    findWorktree: (repoId, name) => findManagedWorktreeByName(runtime, repoId, name),
    createWorktree: async ({ repoId, name, prompt, comment }) => {
      const result = await runtime.createManagedWorktree({
        repoSelector: repoId,
        name,
        comment,
        // Why an explicit startup: never Carson's default args, which carry
        // --dangerously-skip-permissions (see bug-autofix-claude-profile.ts).
        startup: buildBugFixStartup(prompt),
        createdWithAgent: BUG_FIX_AGENT,
        activate: false,
        // Why skip: a cook must never install; the prompt links node_modules.
        setupDecision: 'skip',
        executionOrigin: 'kitchen'
      })
      return { ...toFound(result.worktree), warning: result.warning }
    },
    tellAdam: reportKitchenNotice
  })
}

/** App quit: stop pumping, and refuse any cook whose workspace is still being made. */
export function shutdownKitchen(): void {
  blockExecutionOrigin('kitchen')
  disposeKitchen()
}
