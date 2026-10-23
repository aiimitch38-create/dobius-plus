import { Notification } from 'electron'
import type { Store } from '../persistence'
import type { Automation, AutomationLoop } from '../../shared/automations-types'
import {
  LOOP_STOP_CHECK_TIMEOUT_SECONDS,
  stopCheckDue,
  stopCommandProblem
} from '../../shared/automation-loop-stop'
import { normalizeAutomationLoop } from '../../shared/automation-loops'
import type { Repo } from '../../shared/types'
import { loopTabIdsFromBoards } from './board-group-members'
import type { LoopTerminals } from './loop-terminals'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'
import { runAutomationPrecheck } from './precheck-runner'

export type StopCheckResult = { exitCode: number | null; error: string | null }

/** Runs a loop's stop command in the loop's own worktree (local or over SSH). */
export type LoopStopCheck = (command: string, worktreeId: string) => Promise<StopCheckResult>

/**
 * Why: the worktree id carries the folder path; the repo says whether that
 * path lives on this machine or on an SSH host, so the command runs where the
 * loop's consoles work and never in the app's own directory.
 */
export function createLoopStopCheck(getRepo: (repoId: string) => Repo | undefined): LoopStopCheck {
  return async (command, worktreeId) => {
    const parsed = splitWorktreeIdForFilesystem(worktreeId)
    if (!parsed?.worktreePath) {
      return { exitCode: null, error: 'Loop workspace path is unknown.' }
    }
    const repo = getRepo(parsed.repoId)
    if (!repo) {
      return { exitCode: null, error: 'Loop workspace is no longer available.' }
    }
    const precheck = { command, timeoutSeconds: LOOP_STOP_CHECK_TIMEOUT_SECONDS }
    const result = await runAutomationPrecheck({
      precheck,
      target: repo.connectionId
        ? { type: 'ssh', cwd: parsed.worktreePath, connectionId: repo.connectionId }
        : { type: 'local', cwd: parsed.worktreePath }
    })
    return { exitCode: result.exitCode, error: result.error }
  }
}

export function notifyLoopFinishedByDefault(loopName: string, body: string): void {
  if (typeof Notification !== 'function' || !Notification.isSupported()) {
    return
  }
  new Notification({ title: `Loop finished: ${loopName}`, body }).show()
}

export type StopCheckStore = Pick<
  Store,
  'listAutomations' | 'updateAutomation' | 'getRepo' | 'getUI'
>

export type LoopStopChecksOptions = {
  stopCheck?: LoopStopCheck
  notifyFinished?: (loopName: string, body: string) => void
}

/**
 * Runs each loop's stop command once per delivered run, after the target
 * consoles stop working. Exit 0 retires the loop and notifies. The command
 * runs in the background so a slow build never stalls other loops' ticks.
 */
export class LoopStopChecks {
  private readonly run: LoopStopCheck
  private readonly notify: (loopName: string, body: string) => void
  /** Loops whose stop command is running now; a check never overlaps itself. */
  private readonly checking = new Set<string>()

  constructor(
    private readonly store: StopCheckStore,
    opts: LoopStopChecksOptions
  ) {
    this.run = opts.stopCheck ?? createLoopStopCheck((id) => store.getRepo(id))
    this.notify = opts.notifyFinished ?? notifyLoopFinishedByDefault
  }

  /** Returns true when the loop should not fire this tick (its check is running). */
  async tick(
    automation: Automation,
    loop: AutomationLoop,
    now: number,
    terminals: LoopTerminals | null
  ): Promise<boolean> {
    const command = loop.stopCommand
    if (!command || (loop.state.stopCheckSince ?? null) === null) {
      return false
    }
    if (this.checking.has(automation.id)) {
      return true
    }
    const tabIds = loopTabIdsFromBoards(this.store.getUI().boardsByWorktree, loop)
    const working = await anyWorking(terminals, tabIds)
    if (!stopCheckDue({ pendingSince: loop.state.stopCheckSince, now, targetsWorking: working })) {
      return false
    }
    // The owed check is consumed now, so a crash mid-check never reruns it in a loop.
    this.save(automation.id, now, { lastResult: null, retire: false, clearPending: true })
    const problem = stopCommandProblem(command)
    if (problem) {
      const why =
        problem === 'destructive'
          ? 'it could change or delete files'
          : 'only one plain command is allowed'
      this.save(automation.id, now, { lastResult: `Stop command not run (${why}).`, retire: false })
      return false
    }
    this.checking.add(automation.id)
    void this.run(command, loop.worktreeId)
      .then((result) => {
        const passed = result.exitCode === 0 && !result.error
        const detail = result.error ?? `exit ${result.exitCode}`
        this.save(automation.id, Date.now(), {
          retire: passed,
          lastResult: passed
            ? `\`${command}\` passed; loop finished.`
            : `\`${command}\` did not pass (${detail}); loop continues.`
        })
        if (passed) {
          this.notify(automation.name, `\`${command}\` passed, so the loop stopped.`)
        }
      })
      .catch((error: unknown) => {
        console.error('[board-loops] stop check failed', automation.id, error)
      })
      .finally(() => {
        this.checking.delete(automation.id)
      })
    return true
  }

  /** Writes onto the loop's latest stored state (it may have changed while a check ran). */
  private save(
    automationId: string,
    now: number,
    change: { lastResult: string | null; retire: boolean; clearPending?: boolean }
  ): void {
    const automation = this.store.listAutomations().find((a) => a.id === automationId)
    const loop = automation ? normalizeAutomationLoop(automation.loop) : null
    if (!automation || !loop) {
      return
    }
    const state = {
      ...loop.state,
      ...(change.lastResult !== null ? { lastResult: change.lastResult } : {}),
      ...(change.clearPending ? { stopCheckSince: null } : {}),
      ...(change.retire && loop.state.retiredAt === null ? { retiredAt: now } : {})
    }
    this.store.updateAutomation(automation.id, { loop: { ...loop, state } })
  }
}

async function anyWorking(
  terminals: LoopTerminals | null,
  tabIds: readonly string[]
): Promise<boolean> {
  const isWorking = terminals?.agentWorking
  if (!isWorking) {
    return false
  }
  for (const tabId of tabIds) {
    if (await isWorking(tabId).catch(() => false)) {
      return true
    }
  }
  return false
}
