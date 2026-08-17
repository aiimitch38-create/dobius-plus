import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, Query, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun, AgentRunSource, CustomAgent } from '../../shared/agents'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import { resolveClaudeCommand } from '../codex-cli/command'
import { getAgent, updateAgentSession } from './agents-store'
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
import { appendAgentRunNotification } from './agent-notification-store'
import { appendRunProgress } from './agent-run-progress-log'
import { buildRunEnv, currentGitBranch, resolveAgentRunCwd } from './agent-runner-environment'
import { buildDobiusRunMcpServer, withDobiusToolAllowRule } from './agent-runner-dobius-tools'
import { buildSystemPrompt } from './agent-run-prompt'
import {
  getDefaultPrepareCodexLaunch,
  type PrepareCodexLaunch
} from './default-codex-launch'
import { startCodexAgentProcess } from './codex-agent-execution'
import {
  addStoredAgentRun,
  getStoredAgentRun,
  listStoredAgentRuns,
  updateStoredAgentRun
} from './agent-runs-store'

const MAX_CONCURRENT_RUNS = 3

// Why: the cap must be reserved synchronously — liveRuns is only populated after an
// await (auth preparation), so checking liveRuns.size alone is a check-then-act race.
let reservedRuns = 0
const reservedAgentIds = new Set<string>()

export type PrepareClaudeLaunch = (target?: {
  accountId?: string | null
}) => Promise<ClaudeRuntimeAuthPreparation>

type AgentRunOptions = {
  source?: AgentRunSource
  maxTurns?: number
  maxBudgetUsd?: number
  permissionMode?: Options['permissionMode']
  allowedTools?: string[]
  outputFormat?: Options['outputFormat']
  resume?: boolean
  onResult?: (message: SDKResultMessage) => void
  // Why: onResult only fires when the SDK emits a result message — abnormal EOF
  // and thrown-stream errors need their own hook so channel replies never go silent.
  onRunEnded?: (status: 'error' | 'cancelled', summary: string) => void
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

async function consumeRun(
  runId: string,
  agent: CustomAgent,
  sdkQuery: Query,
  options: Options,
  prompt: string,
  resolvedCwd: string,
  onResult: ((message: SDKResultMessage) => void) | undefined,
  onRunEnded: ((status: 'error' | 'cancelled', summary: string) => void) | undefined
): Promise<void> {
  let sawResult = false
  let sawSystemInit = false
  let activeQuery = sdkQuery
  let resumeRetriedFresh = false
  let delegatedRetry = false
  try {
    for await (const message of activeQuery) {
      if (message.type === 'system' && message.subtype === 'init') {
        sawSystemInit = true
        updateAgentSession(agent.id, {
          lastSessionId: message.session_id,
          lastSessionCwd: resolvedCwd
        })
      }
      for (const event of reduceMessage(message, runId, agent.id)) {
        broadcastRunEvent(event)
      }
      if (message.type === 'result') {
        sawResult = true
        onResult?.(message)
        updateAgentSession(agent.id, {
          lastSessionId: message.session_id,
          lastSessionCwd: resolvedCwd
        })
        // Why: a result already in flight when stopAgentRun fires must not flip a
        // cancelled run back to success/error.
        const current = getStoredAgentRun(runId)
        if (current?.status !== 'cancelled') {
          updateRun(runId, {
            endedAt: Date.now(),
            status: message.subtype === 'success' ? 'success' : 'error',
            summary: message.subtype === 'success' ? message.result : message.errors.join('\n'),
            numTurns: message.num_turns,
            costUsd: message.total_cost_usd
          })
          const finishedRun = getStoredAgentRun(runId)
          if (finishedRun) {
            appendAgentRunNotification(agent, finishedRun)
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
        summary: 'Run ended unexpectedly without a result'
      })
      const finishedRun = getStoredAgentRun(runId)
      if (finishedRun) {
        appendAgentRunNotification(agent, finishedRun)
      }
      onRunEnded?.('error', 'Run ended unexpectedly without a result')
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
        onResult,
        onRunEnded
      )
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    const run = getStoredAgentRun(runId)
    if (run?.status !== 'cancelled') {
      updateRun(runId, { endedAt: Date.now(), status: 'error', summary: message })
      const finishedRun = getStoredAgentRun(runId)
      if (finishedRun) {
        appendAgentRunNotification(agent, finishedRun)
      }
      broadcastRunEvent({ ...eventBase(runId, agent.id), kind: 'error', text: message })
      onRunEnded?.('error', message)
    } else {
      onRunEnded?.('cancelled', 'stopped by user')
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
      reservedAgentIds.delete(agent.id)
      reservedRuns -= 1
      broadcastRunsChanged()
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
  reservedRuns += 1
  reservedAgentIds.add(agent.id)
  const runId = randomUUID()
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
        startedAt: Date.now(),
        status: 'running'
      }
      addRun(run)
      runAdded = true
      startCodexRun({
        runId,
        agent,
        prompt,
        resolvedCwd,
        codexHome,
        onRunEnded: args.options?.onRunEnded
      })
      return runId
    }
    const preparation = await args.prepareClaudeLaunch(
      agent.accountId ? { accountId: agent.accountId } : undefined
    )
    const abortController = new AbortController()
    const resolvedCwd = resolveAgentRunCwd(args.cwd ?? agent.cwd)
    const branch = currentGitBranch(resolvedCwd)
    const systemPrompt = buildSystemPrompt(agent)
    const resume =
      args.options?.resume !== false && agent.lastSessionId && agent.lastSessionCwd === resolvedCwd
        ? agent.lastSessionId
        : undefined
    const permissionMode =
      args.options?.permissionMode ?? (agent.bypassPermissions ? 'bypassPermissions' : 'default')
    const allowedTools = withDobiusToolAllowRule(args.options?.allowedTools ?? agent.allowedTools)
    const options: Options = {
      systemPrompt: systemPrompt || undefined,
      model: agent.model,
      cwd: resolvedCwd,
      allowedTools,
      skills: agent.skills.length > 0 ? agent.skills : undefined,
      tools: args.options?.allowedTools,
      permissionMode,
      allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions' ? true : undefined,
      resume,
      abortController,
      env: buildRunEnv(preparation),
      maxTurns: args.options?.maxTurns ?? 100,
      maxBudgetUsd: args.options?.maxBudgetUsd,
      outputFormat: args.options?.outputFormat
    }
    // Why: the SDK's bundled CLI lives inside app.asar after packaging and cannot
    // be spawned as a real file. Resolve the user's installed Claude CLI so native
    // Communications agents reuse the same OAuth account as Dobius terminals.
    options.pathToClaudeCodeExecutable = resolveClaudeCommand()
    options.mcpServers = { dobius: buildDobiusRunMcpServer(agent.id, runId) }
    options.strictMcpConfig = true
    options.hooks = buildAgentHardRailHooks({ agentId: agent.id })
    if (permissionMode === 'default' && (args.options?.source ?? 'manual') === 'manual') {
      options.canUseTool = createAgentCanUseTool({
        runId,
        agentId: agent.id,
        cwd: resolvedCwd,
        branch
      })
    }
    const run: AgentRun = {
      id: runId,
      agentId: agent.id,
      prompt,
      source: args.options?.source ?? 'manual',
      startedAt: Date.now(),
      status: 'running'
    }
    addRun(run)
    runAdded = true
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
      args.options?.onResult,
      args.options?.onRunEnded
    )
    return runId
  } catch (error) {
    reservedRuns -= 1
    reservedAgentIds.delete(agent.id)
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
  onRunEnded?: (status: 'error' | 'cancelled', summary: string) => void
}): void {
  const child = startCodexAgentProcess({
    agent: args.agent,
    prompt: args.prompt,
    cwd: args.resolvedCwd,
    codexHome: args.codexHome,
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
    onRunEnded?: (status: 'error' | 'cancelled', summary: string) => void
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
    appendAgentRunNotification(args.agent, run)
  }
  if (status !== 'success') {
    args.onRunEnded?.(status, summary)
  }
  appendRunProgress(args.agent.id, status, summary)
  reservedAgentIds.delete(args.agent.id)
  reservedRuns -= 1
  broadcastRunsChanged()
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
    reservedAgentIds.has(agentId) ||
    listStoredAgentRuns().some((run) => run.agentId === agentId && run.status === 'running')
  )
}
