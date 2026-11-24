/* Connects kitchen.ts to the real store, settings, Pause crew gate and
 * runtime, reusing the bug auto-fix launch (restricted Claude profile, own
 * worktree, no setup script). Split out so the loop stays testable. */

import { basename, resolve } from 'node:path'

import {
  blockExecutionOrigin,
  checkExecutionAdmission,
  ExecutionBlockedError,
  setExecutionOriginSwitch
} from '../agents/execution-gate'
import { isGitRepoKind } from '../../shared/repo-kind'
import { KITCHEN_WORKTREE_PREFIX } from '../../shared/bug-fix-agent-profile'
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

/** True for a real, new workspace of the cook's own: its folder carries the
 *  card's kitchen name and is not the project folder itself. */
export function isCookWorkspace(worktreePath: string, name: string, repoPath: string): boolean {
  return (
    name.startsWith(KITCHEN_WORKTREE_PREFIX) &&
    basename(worktreePath) === name &&
    resolve(worktreePath) !== resolve(repoPath)
  )
}

/** The kitchen is local-only for now: a git repo on this Mac. */
export function isKitchenRepo(repo: { kind?: 'git' | 'folder'; connectionId?: string | null }): boolean {
  return isGitRepoKind(repo) && !repo.connectionId
}

const KITCHEN_OFF = 'The kitchen is turned off, so no cook is started.'

export function wireKitchen(store: Store, runtime: DobiusRuntimeService): void {
  const isEnabled = (): boolean => store.getSettings().kitchenEnabled === true
  // Why in the gate: the runtime re-checks it right before every spawn, so
  // turning the kitchen off (or pausing the crew) while a workspace is being
  // made, or mid-restart, still wins.
  setExecutionOriginSwitch('kitchen', isEnabled, KITCHEN_OFF)
  const notCookWorkspace = (worktreePath: string, name: string, repoId: string): string | null => {
    const repo = runtime.listRepos().find((candidate) => candidate.id === repoId)
    return repo && isKitchenRepo(repo) && isCookWorkspace(worktreePath, name, repo.path)
      ? null
      : `${worktreePath} is not a new workspace of the cook's own, so no cook was started in it.`
  }
  configureKitchen({
    listTasks: () => vertexTaskStore.list(),
    updateTask: (taskId, patch) => vertexTaskStore.update(taskId, patch),
    // Why === true (above): off unless Carson turned it on.
    isEnabled,
    maxMinutes: () => store.getSettings().kitchenMaxMinutes ?? KITCHEN_DEFAULT_MAX_MINUTES,
    admission: () => checkExecutionAdmission('kitchen'),
    findRepos: (projectId) =>
      runtime
        .listRepos()
        // Why local git only: a folder project has no worktree or branch to
        // isolate a cook in, and a remote workspace starts its agent before
        // this side can check the folder it landed in.
        .filter((repo) => isKitchenRepo(repo) && projectIdOf(repo.path) === projectId)
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
    // Why exact: only a folder with the card's own kitchen name; never a display name.
    findWorktree: async (repoId, name) =>
      name.startsWith(KITCHEN_WORKTREE_PREFIX)
        ? findManagedWorktreeByName(runtime, repoId, name, { exactFolderOnly: true })
        : null,
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
        // The gate (Pause crew and the kitchen switch) is re-checked right
        // after this, before the agent spawns.
        executionOrigin: 'kitchen',
        prepareWorkspace: (worktreePath) => {
          const refusal = notCookWorkspace(worktreePath, name, repoId)
          if (refusal) {
            // Why this error: any other throw here only becomes a warning.
            throw new ExecutionBlockedError('kitchen', 'paused', refusal)
          }
        }
      })
      // A backstop only (remote repos are refused up front and local ones are
      // checked in prepareWorkspace). The kitchen stops the workspace, and
      // keeps its slot and retries if the stop fails.
      const refusal = notCookWorkspace(result.worktree.path, name, repoId) ?? undefined
      return { ...toFound(result.worktree), warning: result.warning, refusal }
    },
    tellAdam: reportKitchenNotice
  })
}

// Note on restartCook: createTerminal carries executionOrigin 'kitchen', so
// the same gate re-check runs right before the restarted agent spawns.

/** App quit: stop pumping, and refuse any cook whose workspace is still being made. */
export function shutdownKitchen(): void {
  blockExecutionOrigin('kitchen')
  disposeKitchen()
}
