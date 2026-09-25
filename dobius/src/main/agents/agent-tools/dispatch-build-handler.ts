import { getAsanaConfig } from '../../asana/asana-config'
import { appendBriefingItem } from '../agent-briefing-store'
import { getBuildDispatcher, getRepoLister } from '../agent-dispatch-registry'
import {
  clearBuildDispatched,
  markBuildDispatched,
  mayDispatchBuild
} from '../asana-dispatch-ledger'
import { checkBuildDispatchAdmission, checkExecutionAdmission } from '../execution-gate'
import type { DobiusToolContext } from './dobius-tool-handlers'
import { errorResult, textResult, trimText, type TextToolResult } from './dobius-tool-result'

const DISPATCH_BRIEF_LIMIT = 6_000
// Why: dispatch_build launches a terminal agent outside startAgentRun's cap, so
// it holds its own capacity: one worktree creation in flight app-wide, and one
// build per Asana task (recorded in the dispatch ledger, so retried triage runs
// for the same task cannot dispatch again).
const MAX_IN_FLIGHT_BUILD_DISPATCHES = 1
// A worktree creation that never settles must not hold the app-wide slot forever.
export const BUILD_DISPATCH_TIMEOUT_MS = 10 * 60_000
let inFlightBuildDispatches = 0

type DispatchOutcome = { worktreeId: string; ok: boolean; error?: string }

const TIMED_OUT = Symbol('build-dispatch-timed-out')

// Why: an agent-supplied name reaches the worktree/branch name — sanitize to a
// safe slug so a possibly-injected triage agent can't pass '../x' or shell chars.
function sanitizeSlug(value: string, fallback: string): string {
  const slug = value
    .trim()
    .slice(0, 60)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function slugFromBrief(brief: string): string {
  return sanitizeSlug(brief.trim().split(/\s+/).slice(0, 6).join(' '), 'asana-build')
}

function dispatchCapabilityError(context: DobiusToolContext): string | null {
  if (!context.tools.includes('dispatch_build')) {
    return 'build dispatch not permitted: this run has no build capability.'
  }
  if (context.buildLane !== 'build' || !context.asanaTaskGid) {
    return 'build dispatch not permitted: only build-lane Asana tasks may dispatch builds.'
  }
  return null
}

function waitForDispatch(
  pending: Promise<DispatchOutcome>
): Promise<DispatchOutcome | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), BUILD_DISPATCH_TIMEOUT_MS)
  })
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer))
}

function logLateOutcome(gid: string, pending: Promise<DispatchOutcome>): void {
  pending.then(
    (outcome) =>
      console.warn(
        `[agents] build dispatch for Asana task ${gid} settled after the timeout: ${
          outcome.ok ? `created ${outcome.worktreeId}` : `failed (${outcome.error ?? 'no detail'})`
        }`
      ),
    (error: unknown) =>
      console.warn(
        `[agents] build dispatch for Asana task ${gid} failed after the timeout: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
  )
}

export function createDispatchBuildHandler(context: DobiusToolContext) {
  return async (args: {
    repo: string
    brief: string
    branchName?: string
  }): Promise<TextToolResult> => {
    const capabilityError = dispatchCapabilityError(context)
    if (capabilityError) {
      return errorResult(capabilityError)
    }
    const gid = context.asanaTaskGid as string
    const repoQuery = args.repo.trim()
    if (!repoQuery) {
      return errorResult('Repo is required.')
    }
    const brief = trimText(args.brief, DISPATCH_BRIEF_LIMIT).text
    if (!brief.trim()) {
      return errorResult('Build brief is required.')
    }
    const admission = checkExecutionAdmission('dispatch-build')
    if (!admission.allowed) {
      return errorResult(`build dispatch blocked: ${admission.message}`)
    }
    const listRepos = getRepoLister()
    if (!listRepos) {
      return errorResult('build dispatch not available: repo list unavailable.')
    }
    const repos = listRepos()
    const byId = repos.find((entry) => entry.id === repoQuery)
    const byName = byId
      ? []
      : repos.filter((entry) => entry.name.toLowerCase() === repoQuery.toLowerCase())
    // Why: two repos can share a name (a stale copy and the real checkout); taking
    // the first match would build in the wrong one, so the agent must pick by id.
    if (byName.length > 1) {
      const matches = byName.map((entry) => `${entry.id} (${entry.path})`).join(', ')
      return errorResult(
        `Repo name "${repoQuery}" matches more than one repo; retry with one of these ids: ${matches}.`
      )
    }
    const repo = byId ?? byName[0]
    if (!repo) {
      const available = repos.map((entry) => `${entry.name} (${entry.id})`).join(', ') || 'none'
      return errorResult(`Repo not found. Available repos: ${available}.`)
    }
    const dispatch = getBuildDispatcher()
    if (!dispatch) {
      return errorResult('build dispatch unavailable.')
    }
    // Why here: ADAM checks the repo path before the worktree or any paid agent
    // exists, and before the ledger mark or capacity slot, so a refusal costs nothing.
    const adamAdmission = await checkBuildDispatchAdmission(repo.path)
    if (!adamAdmission.allowed) {
      return errorResult(`build dispatch blocked: ${adamAdmission.message}`)
    }
    const name = args.branchName
      ? sanitizeSlug(args.branchName, slugFromBrief(brief))
      : slugFromBrief(brief)
    const buildAgent = getAsanaConfig().autoMode.buildAgent ?? 'claude'
    if (!mayDispatchBuild(gid)) {
      return errorResult(
        `build dispatch refused: a build was already dispatched for Asana task ${gid}.`
      )
    }
    if (inFlightBuildDispatches >= MAX_IN_FLIGHT_BUILD_DISPATCHES) {
      return errorResult(
        'build dispatch refused: another build dispatch is in progress, retry shortly.'
      )
    }
    // Why: mark the build before it can start, so an app crash mid-dispatch
    // leaves the task blocked (outcome unknown) instead of re-dispatchable.
    const mark = markBuildDispatched(gid)
    if (!mark.saved) {
      return errorResult(
        'build dispatch refused: could not record it in the Asana dispatch ledger.'
      )
    }
    // Reserved synchronously right before the only await; released exactly once below.
    inFlightBuildDispatches += 1
    // The async wrapper turns a synchronous dispatcher throw into a rejection.
    const pending = (async () =>
      dispatch({ repoId: repo.id, name, baseBranch: undefined, brief, buildAgent }))()
    let result: DispatchOutcome | typeof TIMED_OUT
    try {
      result = await waitForDispatch(pending)
    } catch (error) {
      inFlightBuildDispatches -= 1
      clearBuildDispatched(gid, mark.created)
      // Why: keep the tool contract (return isError, never reject) local, in case
      // a future dispatcher registration throws instead of catching internally.
      return errorResult(
        `build dispatch failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    inFlightBuildDispatches -= 1
    if (result === TIMED_OUT) {
      // Outcome unknown: the worktree may still appear, so the task stays
      // recorded as dispatched; a human checks and re-queues it if nothing came up.
      logLateOutcome(gid, pending)
      return errorResult(
        `build dispatch timed out after ${BUILD_DISPATCH_TIMEOUT_MS / 60_000} minutes; its outcome is unknown, so no retry is allowed. A human must check ${repo.name}.`
      )
    }
    if (!result.ok) {
      clearBuildDispatched(gid, mark.created)
      return errorResult(result.error || 'build dispatch failed.')
    }
    appendBriefingItem({
      agentId: context.agentId,
      urgency: 'now',
      summary: `Build dispatched: ${repo.name} / ${name}`
    })
    return textResult(`Build dispatched for ${repo.name} / ${name}: ${result.worktreeId}`)
  }
}
