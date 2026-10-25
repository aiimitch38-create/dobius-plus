// Lead loop lifecycle: `lead.init` seeds a repo's .dobius files, `lead.start`
// runs one LeadWatcher per worktree that opens/nudges the Hermes lead console,
// `lead.stop` / `lead.status` manage those watchers. Watchers live in main for
// the life of the process; ~/.dobius/leads/autostart.json remembers which ones
// to bring back on the next launch (see bootLeadsFromAutostart).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { leadConsoleRole } from '../../../../shared/lead-caps'
import {
  bootLeadAutostart,
  isLeadAutostarted,
  readLeadAutostart,
  removeLeadAutostart,
  upsertLeadAutostart,
  type LeadAutostartBootResult
} from '../../../leads/lead-autostart'
import {
  defaultLeadConfig,
  readLeadConfig,
  writeLeadConfigIfMissing,
  type LeadConfig
} from '../../../leads/lead-config'
import { findGitIgnoredLeadFiles, gitIgnoreWarning } from '../../../leads/lead-gitignore'
import { writeLeadSeed } from '../../../leads/lead-seed'
import {
  LeadWatcher,
  classifyAgentStatus,
  type LeadConsoleProbe,
  type LeadWatcherStatus
} from '../../../leads/lead-watcher'
import {
  DOBIUS_DIR_NAME,
  ORCHESTRATOR_FILE_NAME,
  PROJECT_ORCHESTRATOR_STUB,
  resolveOrchestratorInstructions
} from '../../../leads/orchestrator-instructions'
import { vertexTaskStore } from '../../../vertex/vertex-task-store'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { defineMethod, type RpcMethod } from '../core'
import { listBoardConsoleCards, spawnBoardConsole } from './board-consoles'

const WorktreeSelector = z
  .unknown()
  .transform((v) => (typeof v === 'string' ? v : ''))
  .pipe(z.string().min(1, 'Missing worktree selector'))

const LeadWorktreeParams = z.object({ worktree: WorktreeSelector })
const LeadStatusParams = z.object({ worktree: WorktreeSelector.optional() })

export type LeadStatusEntry = LeadWatcherStatus & {
  worktreeId: string
  repoPath: string
  autostart: boolean
}

type LeadWatcherEntry = { watcher: LeadWatcher; config: LeadConfig; repoPath: string }

const watchers = new Map<string, LeadWatcherEntry>()

function placeholdersFor(repoPath: string, config: LeadConfig) {
  return {
    profile: config.profile,
    project: basename(repoPath),
    projectId: config.projectId,
    repoPath,
    maxWorkers: config.maxWorkers,
    workerAgent: config.workerAgent
  }
}

function writeOrchestratorIfMissing(repoPath: string): boolean {
  const filePath = join(repoPath, DOBIUS_DIR_NAME, ORCHESTRATOR_FILE_NAME)
  if (existsSync(filePath)) {
    return false
  }
  mkdirSync(dirname(filePath), { recursive: true })
  // Why: the repo layer is committed content and may only add detail, so init
  // writes a short project stub rather than a copy of the default rules.
  writeFileSync(filePath, PROJECT_ORCHESTRATOR_STUB, { flag: 'wx' })
  return true
}

function statusOf(worktreeId: string, entry: LeadWatcherEntry): LeadStatusEntry {
  return {
    ...entry.watcher.status(),
    worktreeId,
    repoPath: entry.repoPath,
    autostart: isLeadAutostarted(entry.repoPath)
  }
}

type LeadConsoles = {
  /** Lead cards whose terminal is connected and running the agent (idle or busy). */
  consoles: LeadConsoleProbe[]
  /** Lead cards whose terminal is missing, disconnected, or back at a bare shell. */
  staleCardIds: string[]
}

type LeadConsoleRuntime = Pick<
  DobiusRuntimeService,
  'getUIState' | 'listTerminals' | 'getTerminalAgentStatus'
>

/** Exported for tests. */
export async function leadConsoles(
  runtime: LeadConsoleRuntime,
  worktreeId: string,
  profile: string
): Promise<LeadConsoles> {
  const role = leadConsoleRole('lead', profile)
  const cards = listBoardConsoleCards(runtime.getUIState().boardsByWorktree, worktreeId).filter(
    (card) => card.role === role
  )
  if (cards.length === 0) {
    return { consoles: [], staleCardIds: [] }
  }
  const { terminals } = await runtime.listTerminals(`id:${worktreeId}`)
  const live = new Map(terminals.filter((t) => t.connected).map((t) => [t.tabId, t.handle]))
  const consoles: LeadConsoleProbe[] = []
  const staleCardIds: string[] = []
  for (const card of cards) {
    const handle = live.get(card.tabId)
    if (!handle) {
      staleCardIds.push(card.id)
      continue
    }
    // Why: the same signal as the card's status chip ("At its shell"). A card
    // whose agent exited is stale and gets replaced, never typed into.
    const agent = classifyAgentStatus(await runtime.getTerminalAgentStatus(handle))
    // Why: shell probes are returned too, so the watcher can count a launch that
    // died; the card itself is still listed as stale for replacement.
    consoles.push({ handle, agent })
    if (agent === 'shell') {
      staleCardIds.push(card.id)
    }
  }
  return { consoles, staleCardIds }
}

async function startLead(runtime: DobiusRuntimeService, selector: string): Promise<LeadStatusEntry> {
  const worktree = await runtime.showManagedWorktree(selector)
  const existing = watchers.get(worktree.id)
  if (existing) {
    // Why: `lead start` again is the operator's "I fixed the profile, try again".
    existing.watcher.resetLaunchFailures()
    return statusOf(worktree.id, existing)
  }
  const repoPath = worktree.path
  const config = readLeadConfig(repoPath)
  const instructions = resolveOrchestratorInstructions(repoPath, placeholdersFor(repoPath, config))
  const seed = writeLeadSeed({ repoPath, config, instructions: instructions.text })
  const worktreeId = worktree.id

  const watcher = new LeadWatcher({
    profile: config.profile,
    projectId: config.projectId,
    store: vertexTaskStore,
    listLeadConsoles: async () => (await leadConsoles(runtime, worktreeId, config.profile)).consoles,
    spawnLeadConsole: async () => {
      // Why: a lead card whose terminal died or dropped to a bare shell must be
      // replaced, not joined by a second card on every poll.
      const { staleCardIds } = await leadConsoles(runtime, worktreeId, config.profile)
      const { delivered } = await spawnBoardConsole(runtime, {
        worktree: `id:${worktreeId}`,
        agent: 'hermes',
        title: `Lead · ${config.profile}`,
        role: 'lead',
        leadId: config.profile,
        commandOverride: seed.command,
        ...(staleCardIds.length > 0 ? { replaceStaleCardIds: staleCardIds } : {})
      })
      return { delivered }
    },
    sendText: async (handle, text) => {
      await runtime.sendTerminal(handle, { text, enter: true })
    }
  })
  const entry: LeadWatcherEntry = { watcher, config, repoPath }
  watchers.set(worktreeId, entry)
  watcher.start()
  // Why: a started lead must survive an app restart; `lead stop` removes the entry.
  upsertLeadAutostart({ worktreePath: repoPath, profile: config.profile })
  return statusOf(worktreeId, entry)
}

/** Boot hook: restarts every lead that was running when the app last quit. */
export function bootLeadsFromAutostart(
  runtime: DobiusRuntimeService
): Promise<LeadAutostartBootResult> {
  return bootLeadAutostart({
    entries: readLeadAutostart(),
    resolveWorktree: (worktreePath) => runtime.showManagedWorktree(`path:${worktreePath}`),
    start: (selector) => startLead(runtime, selector)
  })
}

export const LEAD_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'lead.init',
    params: LeadWorktreeParams,
    handler: async (params, { runtime }) => {
      const worktree = await runtime.showManagedWorktree(params.worktree)
      const repoPath = worktree.path
      const orchestrator = writeOrchestratorIfMissing(repoPath)
      const leadConfig = writeLeadConfigIfMissing(repoPath, defaultLeadConfig(repoPath))
      const config = readLeadConfig(repoPath)
      const ignored = await findGitIgnoredLeadFiles(repoPath)
      return {
        worktreeId: worktree.id,
        repoPath,
        wrote: { orchestrator, leadConfig },
        profile: config.profile,
        projectId: config.projectId,
        warnings: ignored.length > 0 ? [gitIgnoreWarning(repoPath, ignored)] : []
      }
    }
  }),
  defineMethod({
    name: 'lead.start',
    params: LeadWorktreeParams,
    handler: (params, { runtime }) => startLead(runtime, params.worktree)
  }),
  defineMethod({
    name: 'lead.stop',
    params: LeadWorktreeParams,
    handler: async (params, { runtime }) => {
      const worktree = await runtime.showManagedWorktree(params.worktree)
      const entry = watchers.get(worktree.id)
      // Why: a deliberate stop must also stay stopped across restarts, even when
      // no watcher is running right now (e.g. the entry failed to boot).
      removeLeadAutostart(worktree.path)
      if (!entry) {
        return { worktreeId: worktree.id, stopped: false }
      }
      entry.watcher.stop()
      watchers.delete(worktree.id)
      return { worktreeId: worktree.id, stopped: true }
    }
  }),
  defineMethod({
    name: 'lead.status',
    params: LeadStatusParams,
    handler: async (params, { runtime }) => {
      if (params.worktree) {
        const worktree = await runtime.showManagedWorktree(params.worktree)
        const entry = watchers.get(worktree.id)
        return { watchers: entry ? [statusOf(worktree.id, entry)] : [] }
      }
      return {
        watchers: [...watchers.entries()].map(([worktreeId, entry]) => statusOf(worktreeId, entry))
      }
    }
  })
]
