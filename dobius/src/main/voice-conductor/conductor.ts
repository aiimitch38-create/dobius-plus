// Voice Conductor engine (v2 port of electron/voice-conductor.js).
//
// A long-running background Opus Claude session with no window and no terminal
// tab. In v1 this lived in a detached PTY; in v2 it runs on the SDK
// agent-runner (the truly windowless path). Each voice transcript resumes the
// SAME Claude session so context carries across turns — the v2 analog of
// writing to the v1 conductor PTY's stdin.

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createAgent, listAgents } from '../agents/agents-store'
import { startAgentRun, stopAgentRun } from '../agents/agent-runner'
import { getDefaultPrepareClaudeLaunch } from '../agents/default-claude-launch'
import type { VoiceConductor, VoiceConductorStatus } from './types'
import { CONDUCTOR_SYSTEM_PROMPT } from './conductor-system-prompt'

// The store assigns each agent a random UUID, so the conductor agent is
// identified by this stable name (looked up via listAgents), not a fixed id.
const CONDUCTOR_AGENT_NAME = 'Voice Conductor'
const CONDUCTOR_DIR_NAME = 'dobius-voice-conductor'
const CONDUCTOR_CWD = `~/${CONDUCTOR_DIR_NAME}`
// Opus-class reasoning is required to disambiguate fuzzy transcripts
// ("be to be portal" => "B2B Portal").
const CONDUCTOR_MODEL = 'opus'
const CONDUCTOR_ALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch'
]

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

function conductorDir(): string {
  return join(homedir(), CONDUCTOR_DIR_NAME)
}

function ensureConductorDir(): void {
  // createAgent's assertValidCwd rejects a non-existent cwd, so the dir must
  // exist before the agent is created.
  const dir = conductorDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function ensureAgentId(): string {
  const existing = listAgents().find((agent) => agent.name === CONDUCTOR_AGENT_NAME)
  if (existing) {
    return existing.id
  }
  ensureConductorDir()
  const agents = createAgent({
    name: CONDUCTOR_AGENT_NAME,
    description: 'Background voice-transcript router (SDK agent-runner, no window or tab).',
    model: CONDUCTOR_MODEL,
    cwd: CONDUCTOR_CWD,
    bypassPermissions: true,
    systemPrompt: CONDUCTOR_SYSTEM_PROMPT,
    allowedTools: CONDUCTOR_ALLOWED_TOOLS
  })
  const created = agents.find((agent) => agent.name === CONDUCTOR_AGENT_NAME)
  if (!created) {
    throw new Error('Failed to create the Voice Conductor agent')
  }
  return created.id
}

export function createVoiceConductor(): VoiceConductor {
  const replyStore = createReplyStore()

  let enabled = false
  let running = false
  let currentRunId: string | null = null
  let sessionId: string | null = null
  let lastError: string | null = null
  let agentId: string | null = null
  // Serializes transcript turns so they resume the session one at a time.
  let transcriptChain: Promise<void> = Promise.resolve()

  async function kick(prompt: string, opts: { resume: boolean }): Promise<void> {
    const prepare = getDefaultPrepareClaudeLaunch()
    if (!prepare) {
      throw new Error(
        'Voice Conductor requires the Dobius+ app to be running (no Claude launch preparer registered)'
      )
    }
    if (!agentId) {
      agentId = ensureAgentId()
    }
    running = true
    try {
      const runId = await startAgentRun({
        agentId,
        prompt,
        prepareClaudeLaunch: prepare,
        options: {
          source: 'channel',
          // agent-runner resolves the real session id from the agent's stored
          // lastSessionId; this flag only means "don't force a fresh session".
          resume: opts.resume,
          onResult: (message) => {
            sessionId = message.session_id
            running = false
            currentRunId = null
            lastError = message.subtype === 'success' ? null : message.errors.join('\n')
          },
          onRunEnded: (status, summary) => {
            running = false
            currentRunId = null
            if (status === 'error') {
              lastError = summary
            }
          }
        }
      })
      currentRunId = runId
      lastError = null
    } catch (error) {
      running = false
      currentRunId = null
      lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
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
      agentId = ensureAgentId()
      enabled = true
    },

    async stop() {
      enabled = false
      const runId = currentRunId
      currentRunId = null
      running = false
      if (runId) {
        await stopAgentRun(runId)
      }
    },

    isRunning() {
      return enabled
    },

    getStatus(): VoiceConductorStatus {
      return { enabled, running, runId: currentRunId, sessionId, lastError }
    },

    async postTranscript({ transcript, requestId }) {
      if (!enabled) {
        throw new Error('Voice Conductor is disabled')
      }
      // The v2 analog of writing to the v1 conductor PTY's stdin: a fresh run
      // that resumes the same session, tagged so the reply routes back.
      // Serialize turns — two transcripts resuming the SAME session concurrently
      // would cross or drop each other, so chain them one at a time.
      transcriptChain = transcriptChain
        .catch(() => {})
        .then(() => kick(`[${requestId}] ${transcript}`, { resume: true }))
      return transcriptChain
    },

    setReply(requestId, message) {
      replyStore.set(requestId, message)
    },

    getReply(requestId, sinceTs) {
      return replyStore.get(requestId, sinceTs)
    }
  }
}
