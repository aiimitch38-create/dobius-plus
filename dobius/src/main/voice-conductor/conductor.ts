// Voice Conductor engine (v2 port of electron/voice-conductor.js).
//
// A long-running background Opus Claude session with no window and no terminal
// tab. In v1 this lived in a detached PTY; in v2 it runs on the SDK
// agent-runner (the truly windowless path). Each voice transcript resumes the
// SAME Claude session so context carries across turns — the v2 analog of
// writing to the v1 conductor PTY's stdin.

import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { startAgentRun, stopAgentRun } from '../agents/agent-runner'
import { getDefaultPrepareClaudeLaunch } from '../agents/default-claude-launch'
import type { VoiceConductor, VoiceConductorStatus } from './types'
import {
  CONDUCTOR_ALLOWED_TOOLS,
  ensureConductorAgentId,
  ensureConductorDir
} from './conductor-agent'

// Why explicit: a voice turn is recorded as a 'channel' run, whose implicit
// default budget is $1. The conductor's own limit is set here, shown in its
// status, and explained to Carson when a turn hits it.
export const CONDUCTOR_MAX_BUDGET_USD = 2

export type ReplyEntry = { message: string; ts: number }

/**
 * Pure in-memory reply store. `now` is injectable so the sinceTs semantics can
 * be tested with a fake clock; the real conductor uses Date.now().
 */
export function createReplyStore(now: () => number = () => Date.now()): {
  set(requestId: string, message: string): void
  get(requestId: string, sinceTs?: number): ReplyEntry | null
} {
  const replies = new Map<string, ReplyEntry>()
  const MAX_REPLIES = 500
  return {
    set(requestId, message) {
      replies.set(requestId, { message, ts: now() })
      // Bound memory: evict the oldest entry once over the cap (Map keeps
      // insertion order). Replies are short-lived (one poll cycle), so this
      // never touches an entry a poller still needs.
      if (replies.size > MAX_REPLIES) {
        const oldest = replies.keys().next().value
        if (oldest !== undefined) {
          replies.delete(oldest)
        }
      }
    },
    get(requestId, sinceTs) {
      const entry = replies.get(requestId)
      if (!entry) {
        return null
      }
      // Only surface a reply strictly newer than what the caller last saw.
      if (sinceTs !== undefined && entry.ts <= sinceTs) {
        return null
      }
      return { message: entry.message, ts: entry.ts }
    }
  }
}

/** What Carson hears when a turn ended without a reply of its own. Null = stay quiet. */
export function conductorTurnFailureReply(
  outcome: { subtype: SDKResultMessage['subtype'] } | { ended: 'error' | 'cancelled' }
): string | null {
  if ('ended' in outcome) {
    return outcome.ended === 'cancelled' ? null : 'Voice Conductor could not finish this request.'
  }
  switch (outcome.subtype) {
    case 'success':
      return null
    case 'error_max_budget_usd':
      return `Voice Conductor stopped: this request reached its $${CONDUCTOR_MAX_BUDGET_USD} spending limit before finishing.`
    case 'error_max_turns':
      return 'Voice Conductor stopped: this request reached its step limit before finishing.'
    default:
      return 'Voice Conductor could not finish this request.'
  }
}

export function createVoiceConductor(): VoiceConductor {
  const replyStore = createReplyStore()

  let enabled = false
  let running = false
  let currentRunId: string | null = null
  let sessionId: string | null = null
  let lastError: string | null = null
  let agentId: string | null = null
  // Bumped by stop(): queued turns and late callbacks from an older generation
  // must not start runs or touch the current state.
  let generation = 0
  // Every run this conductor started and has not seen end, with its settle hook.
  const ownedRuns = new Map<string, () => void>()
  let pendingTurns = 0
  // Serializes turns: the next one starts only after the previous run ENDS,
  // because two runs resuming the same session would cross or drop each other.
  let transcriptChain: Promise<void> = Promise.resolve()

  function replyIfSilent(requestId: string, since: number, message: string | null): void {
    if (message && !replyStore.get(requestId, since - 1)) {
      replyStore.set(requestId, message)
    }
  }

  // Resolves once the run is accepted; `settled` resolves when that run has ended.
  // (Wrapped in an object because awaiting a promise of a promise flattens it.)
  async function startTurn(
    requestId: string,
    transcript: string,
    turnGeneration: number
  ): Promise<{ settled: Promise<void> }> {
    const prepare = getDefaultPrepareClaudeLaunch()
    if (!prepare) {
      throw new Error(
        'Voice Conductor requires the Dobius+ app to be running (no Claude launch preparer registered)'
      )
    }
    agentId ??= ensureConductorAgentId()
    const turnStartedAt = Date.now()
    let runId: string | null = null
    let ended = false
    let settle: () => void = () => {}
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    const end = (error: string | null, reply: string | null): void => {
      if (ended) {
        return
      }
      ended = true
      if (runId) {
        ownedRuns.delete(runId)
      }
      if (turnGeneration === generation) {
        if (runId === null || currentRunId === runId) {
          currentRunId = null
          running = false
        }
        lastError = error
        replyIfSilent(requestId, turnStartedAt, reply)
      }
      settle()
    }
    running = true
    try {
      runId = await startAgentRun({
        agentId,
        prompt: `[${requestId}] ${transcript}`,
        prepareClaudeLaunch: prepare,
        options: {
          source: 'channel',
          // Its own tool set only: no channel baseline unioned in, no dobius MCP tools.
          profile: 'voice-conductor',
          allowedTools: CONDUCTOR_ALLOWED_TOOLS,
          maxBudgetUsd: CONDUCTOR_MAX_BUDGET_USD,
          // agent-runner resolves the real session id from the agent's stored
          // lastSessionId; this flag only means "don't force a fresh session".
          resume: true,
          onResult: (message) => {
            if (turnGeneration === generation) {
              sessionId = message.session_id
            }
            const reply = conductorTurnFailureReply({ subtype: message.subtype })
            end(
              message.subtype === 'success' ? null : (reply ?? message.errors.join('\n')),
              reply
            )
          },
          onRunEnded: (status, summary) => {
            end(status === 'error' ? summary : null, conductorTurnFailureReply({ ended: status }))
          }
        }
      })
    } catch (error) {
      if (turnGeneration === generation) {
        running = false
        lastError = error instanceof Error ? error.message : String(error)
      }
      throw error
    }
    if (ended) {
      return { settled }
    }
    ownedRuns.set(runId, () => end(null, null))
    if (turnGeneration !== generation) {
      // stop() ran while this run was being accepted: it is ours, so stop it too.
      ownedRuns.delete(runId)
      await stopAgentRun(runId).finally(() => end(null, null))
      return { settled }
    }
    currentRunId = runId
    lastError = null
    return { settled }
  }

  return {
    async start() {
      if (enabled) {
        return
      }
      // ponytail: no priming run. Enabling just readies the agent + cwd; the
      // FIRST voice transcript establishes the session that later turns resume.
      // The old priming prompt spent a full Opus run (~140k input tokens, ~$0.70)
      // to have the model reply "ready", on every start.
      if (!getDefaultPrepareClaudeLaunch()) {
        throw new Error(
          'Voice Conductor requires the Dobius+ app to be running (no Claude launch preparer registered)'
        )
      }
      ensureConductorDir()
      agentId = ensureConductorAgentId()
      enabled = true
    },

    async stop() {
      enabled = false
      generation += 1
      currentRunId = null
      running = false
      const runs = Array.from(ownedRuns)
      ownedRuns.clear()
      const results = await Promise.allSettled(
        runs.map(([runId, settle]) => stopAgentRun(runId).finally(settle))
      )
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) {
        throw failed.reason
      }
    },

    isRunning() {
      return enabled
    },

    getStatus(): VoiceConductorStatus {
      return {
        enabled,
        running,
        runId: currentRunId,
        sessionId,
        lastError,
        maxBudgetUsd: CONDUCTOR_MAX_BUDGET_USD,
        queuedTurns: Math.max(0, pendingTurns - (running ? 1 : 0))
      }
    },

    postTranscript({ transcript, requestId }) {
      if (!enabled) {
        return Promise.reject(new Error('Voice Conductor is disabled'))
      }
      // The v2 analog of writing to the v1 conductor PTY's stdin: a fresh run
      // that resumes the same session, tagged so the reply routes back.
      const turnGeneration = generation
      const queuedBehindTurn = pendingTurns > 0
      pendingTurns += 1
      let accept: () => void = () => {}
      let refuse: (error: unknown) => void = () => {}
      const accepted = new Promise<void>((resolve, reject) => {
        accept = resolve
        refuse = reject
      })
      transcriptChain = transcriptChain.then(async () => {
        const queuedAt = Date.now()
        try {
          if (!enabled || turnGeneration !== generation) {
            replyIfSilent(requestId, queuedAt, 'Voice Conductor was turned off before this request started.')
            refuse(new Error('Voice Conductor was stopped before this request started'))
            return
          }
          let turn: { settled: Promise<void> }
          try {
            turn = await startTurn(requestId, transcript, turnGeneration)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            replyIfSilent(requestId, queuedAt, `Voice Conductor could not start this request: ${message}`)
            refuse(error)
            return
          }
          accept()
          await turn.settled
        } finally {
          pendingTurns -= 1
        }
      }).catch((error: unknown) => {
        // Keep the chain alive so one broken turn can't wedge every later one.
        console.error('[voice-conductor] turn failed:', error instanceof Error ? error.message : String(error))
      })
      if (!queuedBehindTurn) {
        return accepted
      }
      // Why: a turn can wait minutes behind a running one; the caller gets an
      // immediate ack and a failure to start reaches Carson as the reply.
      accepted.catch((error: unknown) => {
        console.warn(
          '[voice-conductor] queued request not started:',
          error instanceof Error ? error.message : String(error)
        )
      })
      return Promise.resolve()
    },

    setReply(requestId, message) {
      replyStore.set(requestId, message)
    },

    getReply(requestId, sinceTs) {
      return replyStore.get(requestId, sinceTs)
    }
  }
}
