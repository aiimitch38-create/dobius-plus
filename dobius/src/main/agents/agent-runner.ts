import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, Query, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun, AgentRunContext, AgentRunSource, CustomAgent } from '../../shared/agents'
import type { AsanaLane } from '../../shared/asana'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import { resolveClaudeCommand } from '../codex-cli/command'
import { getAgent, getAgentSessionForKey, updateAgentSession } from './agents-store'
import {
  broadcastRunEvent,
  broadcastRunsChanged,
  eventBase,
  reduceMessage
} from './agent-run-events'
import {
  createAgentCanUseTool,
  denyPendingDecisionsForRun,
  setDecisionBypassRunHandler
} from './agent-decision-queue'
import { buildAgentHardRailHooks } from './agent-hard-rails'
import {
  createHeadlessCanUseTool,
  forgetPermissionDenials,
  recordStreamPermissionDenials,
  withPermissionDenialNote
} from './agent-headless-permissions'
import { assertExecutionAdmitted, type ExecutionOrigin } from './execution-gate'
import { claimRunSession, currentRunSessionKey, releaseRunSession } from './agent-session-lease'
import { appendAgentRunNotification } from './agent-notification-store'
import {
  appendRunNotificationSafely,
  guardRunEndCallbacks,
  type GuardedRunEndCallbacks
} from './agent-run-end-callbacks'
import { appendRunProgress } from './agent-run-progress-log'
import { buildRunEnv, currentGitBranch, resolveAgentRunCwd } from './agent-runner-environment'
import {
  buildDobiusRunMcpServer,
  buildProfileAllowedTools,
  builtInToolsFor,
  resolveAgentRunProfile,
  type AgentRunProfileId
} from './agent-runner-dobius-tools'
import { buildSystemPrompt } from './agent-run-prompt'
import {
  getDefaultPrepareCodexLaunch,
  type PrepareCodexLaunch
} from './default-codex-launch'
import { startCodexAgentProcess } from './codex-agent-execution'
import { assertCodexRunSupported, DEFAULT_CODEX_MAX_STEPS } from './codex-run-policy'
import {
  addStoredAgentRun,
  getStoredAgentRun,
  listStoredAgentRuns,
  updateStoredAgentRun
} from './agent-runs-store'

// Channel dispatch fans out to every addressed agent and agent-to-agent chains
// hold a slot while awaiting each other's runs, so 3 starved a two-agent channel
// conversation into "Too many concurrent agent runs".
const MAX_CONCURRENT_RUNS = 8
// Omitting a budget must fail CLOSED. Nine call sites start real Claude runs
// without passing one — including two nobody watches (automation workflow
// steps, boot-time revival of interrupted channel runs) — and an uncapped SDK
// run bills until it decides it is finished. Deliberate callers still pass
// their own ceiling; this only catches the ones that pass nothing.
const DEFAULT_MAX_BUDGET_USD = 2

// Why: the cap must be reserved synchronously — liveRuns is only populated after an
// await (auth preparation), so checking liveRuns.size alone is a check-then-act race.
let reservedRuns = 0
// Per-agent live-run COUNT, not a Set: with a Set, the first of two concurrent
// runs for one agent deleted the shared entry on finish, so hasLiveAgentRun
// went false while the second run was still working (heartbeat double-fires).
// Counting also lets an agent run several tasks in parallel across channels.
const reservedAgentRuns = new Map<string, number>()

function reserveAgentRun(agentId: string): void {
  reservedAgentRuns.set(agentId, (reservedAgentRuns.get(agentId) ?? 0) + 1)
}

function releaseAgentRun(agentId: string): void {
  const count = (reservedAgentRuns.get(agentId) ?? 1) - 1
  if (count <= 0) {
    reservedAgentRuns.delete(agentId)
  } else {
    reservedAgentRuns.set(agentId, count)
  }
}

export type PrepareClaudeLaunch = (target?: {
  accountId?: string | null
}) => Promise<ClaudeRuntimeAuthPreparation>

type AgentRunOptions = {
  source?: AgentRunSource
  /**
   * Task-context key: each Communications channel passes its channel id, so an
   * agent keeps a SEPARATE continuing session per channel ("each channel is
   * its own task"). Absent = 'default' (manual runs, the legacy session).
   */
  sessionKey?: string
  maxTurns?: number
  maxBudgetUsd?: number
  /** Per-run model override. Absent = the agent's configured model. */
  model?: string
  permissionMode?: Options['permissionMode']
  /**
   * Explicit tool list for this run. When given it also bounds which built-in
   * tools are available (SDK `tools`); omitted = the agent's allowlist with the
   * SDK's default built-in set.
   */
  allowedTools?: string[]
  /** Tool profile; defaults to `source`. See agent-runner-dobius-tools.ts. */
  profile?: AgentRunProfileId
  /** Set when the Voice Conductor started this run; it inherits the conductor's hard rails. */
  spawnedBy?: 'voice-conductor'
  /** Trusted Asana lane and task for 'asana' runs; only a build-lane task grants dispatch_build. */
  asanaLane?: AsanaLane
  asanaTaskGid?: string
  outputFormat?: Options['outputFormat']
  resume?: boolean
  onResult?: (message: SDKResultMessage) => void
  context?: AgentRunContext
  // Why: onResult only fires when the SDK emits a result message — abnormal EOF
  // and thrown-stream errors need their own hook so channel replies never go silent.
  onRunEnded?: (status: 'error' | 'cancelled', summary: string) => void
  // Fires once, after the run's session lease and slot are released: a caller
  // that starts the next turn from onResult would find the session still busy.
  onSettled?: () => void
  // Omitted = autonomous, so a new caller cannot bypass Pause crew by forgetting it.
  origin?: ExecutionOrigin
}

type LiveRun = {
  query: Query
  abortController: AbortController
}

const liveRuns = new Map<string, LiveRun>()
const liveCodexRuns = new Map<string, ChildProcess>()

setDecisionBypassRunHandler(async (runId) => {
  const liveRun = liveRuns.get(runId)
  if (!liveRun) {
    throw new Error('Run is no longer active')
  }
  await liveRun.query.setPermissionMode('bypassPermissions')
})

function addRun(run: AgentRun): void {
  addStoredAgentRun(run)
  broadcastRunsChanged()
}

function updateRun(runId: string, updates: Partial<AgentRun>): void {
  if (updateStoredAgentRun(runId, updates)) {
    broadcastRunsChanged()
  }
}

// Why: keyed by the run's claim, not the stored run: history is display state,
// and a reset since the run started must not be undone by it.
function recordRunSession(agentId: string, runId: string, sessionId: string, cwd: string): void {
  const sessionKey = currentRunSessionKey(runId)
  if (sessionKey !== null) {
    updateAgentSession(agentId, { lastSessionId: sessionId, lastSessionCwd: cwd, sessionKey })
  }
}

async function consumeRun(
  runId: string,
  agent: CustomAgent,
  sdkQuery: Query,
  options: Options,
  prompt: string,
  resolvedCwd: string,
  callbacks: GuardedRunEndCallbacks
): Promise<void> {
  const { onResult, onRunEnded } = callbacks
  let sawResult = false
  let sawSystemInit = false
  let activeQuery = sdkQuery
  let resumeRetriedFresh = false
  let delegatedRetry = false
  try {
    for await (const message of activeQuery) {
      if (message.type === 'system' && message.subtype === 'init') {
        sawSystemInit = true
        recordRunSession(agent.id, runId, message.session_id, resolvedCwd)
      }
      for (const event of reduceMessage(message, runId, agent.id)) {
        broadcastRunEvent(event)
      }
      recordStreamPermissionDenials({ runId, agentId: agent.id }, message)
      if (message.type === 'result') {
        sawResult = true
        onResult(message)
        recordRunSession(agent.id, runId, message.session_id, resolvedCwd)
        // Why: a result already in flight when stopAgentRun fires must not flip a
        // cancelled run back to success/error.
        const current = getStoredAgentRun(runId)
        if (current?.status !== 'cancelled') {
          updateRun(runId, {
            endedAt: Date.now(),
            status: message.subtype === 'success' ? 'success' : 'error',
            summary: withPermissionDenialNote(
              runId,
              message.subtype === 'success' ? message.result : message.errors.join('\n')
            ),
            numTurns: message.num_turns,
            costUsd: message.total_cost_usd
          })
          const finishedRun = getStoredAgentRun(runId)
          if (finishedRun) {
            appendRunNotificationSafely(agent, finishedRun)
          }
        }
      }
    }
    const run = getStoredAgentRun(runId)
    if (!sawResult && run?.status === 'running') {
      // Why: a stream that ends without a result message is an abnormal EOF (agent
      // process died) — never label it success.
      updateRun(runId, {
        endedAt: Date.now(),
        status: 'error',
        summary: withPermissionDenialNote(runId, 'Run ended unexpectedly without a result')
      })
      const finishedRun = getStoredAgentRun(runId)
      if (finishedRun) {
        appendRunNotificationSafely(agent, finishedRun)
      }
      onRunEnded('error', 'Run ended unexpectedly without a result')
    } else if (!sawResult && run?.status === 'cancelled') {
      // Why: a stop can end the stream cleanly instead of throwing; callers
      // holding a slot until the run ends must still hear about it.
      onRunEnded('cancelled', 'stopped by user')
    }
  } catch (error) {
    if (options.resume && !sawSystemInit && !resumeRetriedFresh) {
      resumeRetriedFresh = true
      const retryOptions: Options = { ...options, resume: undefined }
      const retryQuery = query({ prompt, options: retryOptions })
      activeQuery = retryQuery
      liveRuns.set(runId, {
        query: retryQuery,
        abortController: options.abortController as AbortController
      })
      broadcastRunEvent({
        ...eventBase(runId, agent.id),
        kind: 'system',
        detail: 'Resume failed; starting a fresh session'
      })
      delegatedRetry = true
      await consumeRun(
        runId,
        agent,
        retryQuery,
        retryOptions,
        prompt,
        resolvedCwd,
        callbacks
      )
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    const run = getStoredAgentRun(runId)
    if (run?.status !== 'cancelled') {
      updateRun(runId, {
        endedAt: Date.now(),
        status: 'error',
        summary: withPermissionDenialNote(runId, message)
      })
      const finishedRun = getStoredAgentRun(runId)
      if (finishedRun) {
        appendRunNotificationSafely(agent, finishedRun)
      }
      broadcastRunEvent({ ...eventBase(runId, agent.id), kind: 'error', text: message })
      onRunEnded('error', message)
    } else {
      onRunEnded('cancelled', 'stopped by user')
    }
  } finally {
    // The retry invocation owns finalization when we delegated to it.
    if (!delegatedRetry) {
      const finalRun = getStoredAgentRun(runId)
      if (finalRun && finalRun.status !== 'running') {
        denyPendingDecisionsForRun(runId, `Run ended with status ${finalRun.status}`)
        appendRunProgress(agent.id, finalRun.status, finalRun.summary)
      }
      liveRuns.delete(runId)
      forgetPermissionDenials(runId)
      releaseRunSession(runId)
      releaseAgentRun(agent.id)
      reservedRuns -= 1
      broadcastRunsChanged()
      callbacks.onSettled()
    }
  }
}

export async function startAgentRun(args: {
  agentId: string
  prompt: string
  cwd?: string
  prepareClaudeLaunch: PrepareClaudeLaunch
  prepareCodexLaunch?: PrepareCodexLaunch
  options?: AgentRunOptions
}): Promise<string> {
  const origin = args.options?.origin ?? 'agent-run'
  assertExecutionAdmitted(origin)
  if (reservedRuns >= MAX_CONCURRENT_RUNS) {
    throw new Error('Too many concurrent agent runs')
  }
  const agent = getAgent(args.agentId)
  if (!agent) {
    throw new Error('Agent not found')
  }
  const prompt = args.prompt.trim()
  if (!prompt) {
    throw new Error('Prompt is required')
  }
  if (agent.engine === 'codex') {
    // Before any reservation or spawn: Codex cannot enforce restricted profiles.
    assertCodexRunSupported(args.options)
  }
  reservedRuns += 1
  reserveAgentRun(agent.id)
  const sessionKey = args.options?.sessionKey ?? 'default'
  const runId = randomUUID()
  // A live run on the SAME (agent, sessionKey) means that conversation thread
  // is mid-turn: the new run must not resume its session (two writers on one
  // transcript) and starts fresh. Different sessionKeys (other channels) run
  // in parallel, each resuming its own thread. Claimed before any await.
  const sessionKeyBusy = !claimRunSession(runId, agent.id, sessionKey)
  let runAdded = false
  try {
    if (agent.engine === 'codex') {
      const prepareCodexLaunch = args.prepareCodexLaunch ?? getDefaultPrepareCodexLaunch()
      if (!prepareCodexLaunch) {
        throw new Error('Codex account preparation is unavailable')
      }
      const codexHome = prepareCodexLaunch(
        agent.accountId ? { accountId: agent.accountId } : undefined
      )
      const resolvedCwd = resolveAgentRunCwd(args.cwd ?? agent.cwd)
      const run: AgentRun = {
        id: runId,
        agentId: agent.id,
        prompt,
        source: args.options?.source ?? 'manual',
        context: args.options?.context ?? { correlationId: runId },
        sessionKey,
        startedAt: Date.now(),
        status: 'running'
      }
      addRun(run)
      runAdded = true
      broadcastRunEvent({ ...eventBase(runId, agent.id), kind: 'system', detail: 'Run accepted' })
      startCodexRun({
        runId,
        agent,
        prompt,
        resolvedCwd,
        codexHome,
        model: args.options?.model,
        maxSteps: args.options?.maxTurns ?? DEFAULT_CODEX_MAX_STEPS,
        callbacks: guardRunEndCallbacks(args.options)
      })
      return runId
    }
    const preparation = await args.prepareClaudeLaunch(
      agent.accountId ? { accountId: agent.accountId } : undefined
    )
    // Why: the crew can be paused while auth preparation is awaited.
    assertExecutionAdmitted(origin)
    const abortController = new AbortController()
    const resolvedCwd = resolveAgentRunCwd(args.cwd ?? agent.cwd)
    const branch = currentGitBranch(resolvedCwd)
    const systemPrompt = buildSystemPrompt(agent)
    const keyedSession = getAgentSessionForKey(agent, sessionKey)
    const resume =
      args.options?.resume !== false &&
      !sessionKeyBusy &&
      keyedSession &&
      keyedSession.cwd === resolvedCwd
        ? keyedSession.sessionId
        : undefined
    const permissionMode =
      args.options?.permissionMode ?? (agent.bypassPermissions ? 'bypassPermissions' : 'default')
    const profile = resolveAgentRunProfile({
      source: args.options?.source ?? 'manual',
      profile: args.options?.profile,
      asanaLane: args.options?.asanaLane,
      asanaTaskGid: args.options?.asanaTaskGid
    })
    const configuredTools = args.options?.allowedTools ?? agent.allowedTools
    // Channel-profile runs get the working baseline unioned in — see
    // CHANNEL_AGENT_BASELINE_TOOLS for why old agents need it.
    const allowedTools = buildProfileAllowedTools(profile, configuredTools)
    const isChannelRun = (args.options?.source ?? 'manual') === 'channel'
    const options: Options = {
      systemPrompt: systemPrompt || undefined,
      model: args.options?.model ?? agent.model,
      cwd: resolvedCwd,
      allowedTools,
      skills: agent.skills.length > 0 ? agent.skills : undefined,
      tools: builtInToolsFor(args.options?.allowedTools),
      permissionMode,
      allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions' ? true : undefined,
      resume,
      abortController,
      env: buildRunEnv(preparation),
      maxTurns: args.options?.maxTurns ?? 100,
      // Channel chat is cheap now (~$0.20/run on Sonnet with length limits);
      // $1 is ~5x a typical run — real work never dies mid-task, runaways stop.
      maxBudgetUsd:
        args.options?.maxBudgetUsd ?? (isChannelRun ? 1 : DEFAULT_MAX_BUDGET_USD),
      outputFormat: args.options?.outputFormat,
      // Load the project's CLAUDE.md / memory at the agent's cwd — without this
      // an agent runs blind to the very files that define how work happens in
      // its folder.
      // Channel runs deliberately SKIP 'user': the operator's ~/.claude carries
      // a 195-skill catalog plus global CLAUDE.md that measured 9,906 tokens on
      // every cold boot, and channel agents get their skills named explicitly
      // per-agent instead. Hard rails come from buildAgentHardRailHooks below,
      // not from settings, so dropping 'user' does not weaken them.
      settingSources: isChannelRun ? ['project'] : ['user', 'project']
    }
    // Why: the SDK's bundled CLI lives inside app.asar after packaging and cannot
    // be spawned as a real file. Resolve the user's installed Claude CLI so native
    // Communications agents reuse the same OAuth account as Dobius terminals.
    options.pathToClaudeCodeExecutable = resolveClaudeCommand()
    options.mcpServers =
      profile.dobiusTools.length > 0
        ? { dobius: buildDobiusRunMcpServer(agent.id, runId, profile) }
        : {}
    // Not strict: agents should see the user's configured MCP servers
    // (Playwright browsing, connectors) alongside the per-run dobius server.
    // Access is still gated per-agent by allowedTools — an MCP server being
    // loaded does not allow its tools unless the agent's allowlist names them.
    options.strictMcpConfig = false
    options.hooks = buildAgentHardRailHooks({ agentId: agent.id, profile: profile.id, spawnedBy: args.options?.spawnedBy })
    const source = args.options?.source ?? 'manual'
    // Only a person who pressed Run on the Agents page watches the decision
    // queue. Every other run (heartbeat, Asana, iMessage, workflows, RPC/CLI,
    // even with source 'manual') is headless: its prompts are denied at once
    // and recorded on the run, never left waiting or silently refused.
    const attended = source === 'manual' && origin === 'agents-page'
    if (attended && permissionMode === 'default') {
      options.canUseTool = createAgentCanUseTool({
        runId,
        agentId: agent.id,
        cwd: resolvedCwd,
        branch,
        // The CLI only accepts a switch into bypass for sessions launched with
        // --allow-dangerously-skip-permissions.
        bypassRunSupported: options.allowDangerouslySkipPermissions === true
      })
    } else if (!attended) {
      options.canUseTool = createHeadlessCanUseTool({ runId, agentId: agent.id, source })
    }
    const run: AgentRun = {
      id: runId,
      agentId: agent.id,
      prompt,
      source: args.options?.source ?? 'manual',
      context: args.options?.context ?? { correlationId: runId },
      sessionKey,
      startedAt: Date.now(),
      status: 'running'
    }
    addRun(run)
    runAdded = true
    broadcastRunEvent({ ...eventBase(runId, agent.id), kind: 'system', detail: 'Run accepted' })
    const sdkQuery = query({ prompt, options })
    liveRuns.set(runId, { query: sdkQuery, abortController })
    // consumeRun's finally owns releasing the reservation from here on.
    void consumeRun(
      runId,
      agent,
      sdkQuery,
      options,
      prompt,
      resolvedCwd,
      guardRunEndCallbacks(args.options)
    )
    return runId
  } catch (error) {
    reservedRuns -= 1
    releaseAgentRun(agent.id)
    releaseRunSession(runId)
    liveRuns.delete(runId)
    const message = error instanceof Error ? error.message : String(error)
    if (runAdded) {
      updateRun(runId, { endedAt: Date.now(), status: 'error', summary: message })
      broadcastRunEvent({ ...eventBase(runId, agent.id), kind: 'error', text: message })
    }
    throw error
  }
}

function startCodexRun(args: {
  runId: string
  agent: CustomAgent
  prompt: string
  resolvedCwd: string
  codexHome: string | null
  model?: string
  maxSteps: number
  callbacks: GuardedRunEndCallbacks
}): void {
  const child = startCodexAgentProcess({
    agent: args.agent,
    prompt: args.prompt,
    cwd: args.resolvedCwd,
    codexHome: args.codexHome,
    model: args.model,
    maxSteps: args.maxSteps,
    isCancelled: () => getStoredAgentRun(args.runId)?.status === 'cancelled',
    onAssistantText: (text) => {
      broadcastRunEvent({
        ...eventBase(args.runId, args.agent.id),
        kind: 'assistant-text',
        text
      })
    },
    onFinish: (status, summary) => finishCodexRun(args, status, summary)
  })
  liveCodexRuns.set(args.runId, child)
}

function finishCodexRun(
  args: {
    runId: string
    agent: CustomAgent
    callbacks: GuardedRunEndCallbacks
  },
  status: 'success' | 'error' | 'cancelled',
  summary: string
): void {
  if (!liveCodexRuns.has(args.runId)) {
    return
  }
  liveCodexRuns.delete(args.runId)
  updateRun(args.runId, { endedAt: Date.now(), status, summary })
  const run = getStoredAgentRun(args.runId)
  if (run) {
    appendRunNotificationSafely(args.agent, run)
  }
  if (status !== 'success') {
    args.callbacks.onRunEnded(status, summary)
  }
  appendRunProgress(args.agent.id, status, summary)
  releaseRunSession(args.runId)
  releaseAgentRun(args.agent.id)
  reservedRuns -= 1
  broadcastRunsChanged()
  args.callbacks.onSettled()
}

export async function stopAgentRun(runId: string): Promise<void> {
  const codexRun = liveCodexRuns.get(runId)
  if (codexRun) {
    updateRun(runId, { endedAt: Date.now(), status: 'cancelled', summary: 'cancelled' })
    codexRun.kill('SIGTERM')
    return
  }
  const liveRun = liveRuns.get(runId)
  if (!liveRun) {
    return
  }
  updateRun(runId, { endedAt: Date.now(), status: 'cancelled', summary: 'cancelled' })
  const run = getStoredAgentRun(runId)
  const agent = run ? getAgent(run.agentId) : null
  if (run && agent) {
    appendAgentRunNotification(agent, run)
  }
  denyPendingDecisionsForRun(runId, 'Run stopped by user')
  liveRun.abortController.abort()
  await liveRun.query.interrupt()
}

export function listAgentRuns(): AgentRun[] {
  return listStoredAgentRuns()
}

export function hasLiveAgentRun(agentId: string): boolean {
  return (
    (reservedAgentRuns.get(agentId) ?? 0) > 0 ||
    listStoredAgentRuns().some((run) => run.agentId === agentId && run.status === 'running')
  )
}
