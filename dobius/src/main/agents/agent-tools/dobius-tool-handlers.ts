import type { AsanaLane } from '../../../shared/asana'
import type { Store } from '../../persistence'
import { getAsanaConfig } from '../../asana/asana-config'
import { appendBriefingItem } from '../agent-briefing-store'
import { appendDraft } from '../agent-draft-store'
import { listAgents } from '../agents-store'
import { getBuildDispatcher, getRepoLister } from '../agent-dispatch-registry'
import { checkExecutionAdmission } from '../execution-gate'
import { vertexTaskStore } from '../../vertex/vertex-task-store'
import {
  buildKnowledgeTree,
  isAllowedKnowledgePath,
  safeReadFile
} from '../../ipc/knowledge-indexer'

const ASANA_BODY_LIMIT = 4_000
const KNOWLEDGE_RESPONSE_LIMIT = 1_500
const DISPATCH_BRIEF_LIMIT = 6_000
const BOARD_TASK_DESCRIPTION_LIMIT = 4_000
// Why: dispatch_build launches a terminal agent outside startAgentRun's cap, so
// it holds its own capacity: one worktree creation in flight app-wide, and one
// successful build per run (a triage run handles exactly one Asana task).
const MAX_IN_FLIGHT_BUILD_DISPATCHES = 1
const MAX_BUILDS_PER_RUN = 1
let inFlightBuildDispatches = 0

export type DobiusToolName =
  | 'post_channel_message'
  | 'post_channel_screenshot'
  | 'create_board_task'
  | 'asana_draft_comment'
  | 'dispatch_build'
  | 'read_knowledge'
  | 'list_crew'
  | 'crew_status'
  | 'file_briefing_item'

export type DobiusToolContext = {
  agentId: string
  runId: string
  /** The run profile's tool set: only these are registered, and privileged handlers re-check it. */
  tools: readonly DobiusToolName[]
  /** Trusted Asana lane set by the runner's caller, never by the model. */
  buildLane?: AsanaLane
}

type TextToolResult = {
  content: [{ type: 'text'; text: string }]
  isError?: boolean
}

type KnowledgeLeafSummary = {
  id: string
  title: string
  summary: string
  filePath: string
}

function textResult(text: string): TextToolResult {
  return { content: [{ type: 'text', text }] }
}

function errorResult(text: string): TextToolResult {
  return { isError: true, content: [{ type: 'text', text }] }
}

function trimText(value: string, maxLength: number): { text: string; truncated: boolean } {
  if (value.length <= maxLength) {
    return { text: value, truncated: false }
  }
  return { text: value.slice(0, maxLength), truncated: true }
}

function allKnowledgeLeaves(store: Store): KnowledgeLeafSummary[] {
  return buildKnowledgeTree(store).branches.flatMap((branch) =>
    branch.leaves.map((leaf) => ({
      id: leaf.id,
      title: leaf.title,
      summary: leaf.summary,
      filePath: leaf.filePath
    }))
  )
}

function excerpt(content: string, query: string, maxLength: number): string {
  const normalizedQuery = query.trim().toLowerCase()
  const matchIndex = normalizedQuery ? content.toLowerCase().indexOf(normalizedQuery) : -1
  const start = matchIndex > 80 ? matchIndex - 80 : 0
  const slice = content
    .slice(start, start + maxLength)
    .replace(/\s+/g, ' ')
    .trim()
  return start > 0 ? `...${slice}` : slice
}

function redactSensitiveText(value: string): string {
  return value.replace(/\b(token|secret|password|api[_-]?key)\s*[:=]?\s*\S+/gi, '$1 [redacted]')
}

function readAllowedLeafContent(leaf: KnowledgeLeafSummary, store: Store): string | null {
  if (!isAllowedKnowledgePath(leaf.filePath, store)) {
    return null
  }
  return safeReadFile(leaf.filePath)
}

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
  if (context.buildLane !== 'build') {
    return 'build dispatch not permitted: only build-lane Asana tasks may dispatch builds.'
  }
  return null
}

export function createDobiusToolHandlers(context: DobiusToolContext, store: Store | null) {
  let buildsDispatchedByRun = 0
  return {
    async createBoardTask(args: {
      title: string
      description?: string
      assignee?: string
      parentTaskId?: string
      status?: 'backlog' | 'todo' | 'in-progress' | 'blocked' | 'review' | 'testing'
      priority?: 'low' | 'medium' | 'high' | 'urgent'
      type?: 'feature' | 'design' | 'integration' | 'ai' | 'security' | 'infra' | 'bug'
    }): Promise<TextToolResult> {
      const title = args.title.trim()
      if (!title) {
        return errorResult('Task title is required.')
      }
      const assigneeQuery = args.assignee?.trim()
      const assignee = assigneeQuery
        ? listAgents().find(
            (agent) =>
              agent.id === assigneeQuery || agent.name.toLowerCase() === assigneeQuery.toLowerCase()
          )
        : null
      if (assigneeQuery && !assignee) {
        const available = listAgents().map((agent) => agent.name).join(', ') || 'none'
        return errorResult(`Assignee not found. Available agents: ${available}.`)
      }
      const description = args.description
        ? trimText(redactSensitiveText(args.description), BOARD_TASK_DESCRIPTION_LIMIT).text
        : ''
      const task = vertexTaskStore.create({
        title,
        description,
        status: args.status ?? 'todo',
        priority: args.priority ?? 'medium',
        type: args.type ?? 'feature',
        destination: 'system',
        parentTaskId: args.parentTaskId?.trim() || undefined,
        assignee: assignee
          ? { kind: 'agent', id: assignee.id, name: assignee.name, initials: assignee.name.slice(0, 2).toUpperCase() }
          : undefined,
        origin: {
          kind: 'agent',
          name: context.agentId,
          note: 'Created from a Communications agent handoff.'
        }
      })
      return textResult(
        `Created board task ${task.id}: "${task.title}"${assignee ? ` assigned to ${assignee.name}` : ''}.`
      )
    },

    async asanaDraftComment(args: { gid: string; body: string }): Promise<TextToolResult> {
      const gid = args.gid.trim()
      if (!gid) {
        return errorResult('Asana gid is required.')
      }
      const trimmed = trimText(args.body, ASANA_BODY_LIMIT)
      const body = trimmed.truncated
        ? `${trimmed.text}\n\n[Draft truncated to ${ASANA_BODY_LIMIT} characters.]`
        : trimmed.text
      const draft = appendDraft({
        agentId: context.agentId,
        target: { kind: 'asana', gid },
        body
      })
      appendBriefingItem({
        agentId: context.agentId,
        urgency: 'digest',
        summary: `Draft Asana comment ready for ${gid}`
      })
      const suffix = trimmed.truncated ? ' Body was truncated before queuing.' : ''
      return textResult(
        `Draft ${draft.id} queued for human approval for Asana task ${gid}.${suffix}`
      )
    },

    async dispatchBuild(args: {
      repo: string
      brief: string
      branchName?: string
    }): Promise<TextToolResult> {
      const capabilityError = dispatchCapabilityError(context)
      if (capabilityError) {
        return errorResult(capabilityError)
      }
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
      const repo =
        repos.find((entry) => entry.id === repoQuery) ??
        repos.find((entry) => entry.name.toLowerCase() === repoQuery.toLowerCase())
      if (!repo) {
        const available = repos.map((entry) => entry.name).join(', ') || 'none'
        return errorResult(`Repo not found. Available repos: ${available}.`)
      }
      const dispatch = getBuildDispatcher()
      if (!dispatch) {
        return errorResult('build dispatch unavailable.')
      }
      const name = args.branchName
        ? sanitizeSlug(args.branchName, slugFromBrief(brief))
        : slugFromBrief(brief)
      const buildAgent = getAsanaConfig().autoMode.buildAgent ?? 'claude'
      if (buildsDispatchedByRun >= MAX_BUILDS_PER_RUN) {
        return errorResult('build dispatch refused: this run already dispatched its build.')
      }
      if (inFlightBuildDispatches >= MAX_IN_FLIGHT_BUILD_DISPATCHES) {
        return errorResult(
          'build dispatch refused: another build dispatch is in progress, retry shortly.'
        )
      }
      // Reserved synchronously right before the only await; released on both exits below.
      inFlightBuildDispatches += 1
      buildsDispatchedByRun += 1
      let result: { worktreeId: string; ok: boolean; error?: string }
      try {
        result = await dispatch({ repoId: repo.id, name, baseBranch: undefined, brief, buildAgent })
      } catch (error) {
        inFlightBuildDispatches -= 1
        buildsDispatchedByRun -= 1
        // Why: keep the tool contract (return isError, never reject) local, in case
        // a future dispatcher registration throws instead of catching internally.
        return errorResult(
          `build dispatch failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      inFlightBuildDispatches -= 1
      if (!result.ok) {
        buildsDispatchedByRun -= 1
        return errorResult(result.error || 'build dispatch failed.')
      }
      appendBriefingItem({
        agentId: context.agentId,
        urgency: 'now',
        summary: `Build dispatched: ${repo.name} / ${name}`
      })
      return textResult(`Build dispatched for ${repo.name} / ${name}: ${result.worktreeId}`)
    },

    async readKnowledge(args: { query: string; leafId?: string }): Promise<TextToolResult> {
      if (!store) {
        return errorResult('Knowledge is unavailable because the persistence store is not wired.')
      }
      try {
        const leaves = allKnowledgeLeaves(store)
        if (args.leafId) {
          const leaf = leaves.find((entry) => entry.id === args.leafId)
          if (!leaf) {
            return errorResult('Knowledge leaf was not found.')
          }
          const content = readAllowedLeafContent(leaf, store)
          if (content === null) {
            return errorResult('Knowledge leaf could not be read from an allowed knowledge path.')
          }
          const trimmed = trimText(content, KNOWLEDGE_RESPONSE_LIMIT)
          return textResult(`${leaf.title}\n${leaf.summary}\n\n${trimmed.text}`)
        }
        const query = args.query.trim().toLowerCase()
        if (!query) {
          return errorResult('Knowledge query is required.')
        }
        const matches = leaves
          .filter((leaf) => `${leaf.title}\n${leaf.summary}`.toLowerCase().includes(query))
          .slice(0, 3)
        if (matches.length === 0) {
          return textResult('No matching knowledge leaves found.')
        }
        let remaining = KNOWLEDGE_RESPONSE_LIMIT
        const blocks: string[] = []
        for (const leaf of matches) {
          const content = readAllowedLeafContent(leaf, store)
          if (content === null) {
            blocks.push(`${leaf.title}\n${leaf.summary}\n[content unavailable]`)
            continue
          }
          const head = `${leaf.title}\n${leaf.summary}\n`
          const body = excerpt(content, args.query, Math.max(120, remaining - head.length))
          remaining -= head.length + body.length
          blocks.push(`${head}${body}`)
          if (remaining <= 0) {
            break
          }
        }
        return textResult(blocks.join('\n\n---\n\n'))
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : 'Knowledge lookup failed.')
      }
    },

    async listCrew(): Promise<TextToolResult> {
      const lines = listAgents().map((agent) => {
        const description = agent.description || 'no description'
        const heartbeat = agent.heartbeat.enabled ? 'heartbeat:on' : 'heartbeat:off'
        const imessage = agent.channels.imessage ? 'imessage:on' : 'imessage:off'
        return `${agent.name} - ${description} - model:${agent.model} - ${heartbeat} - ${imessage}`
      })
      return textResult(lines.length > 0 ? lines.join('\n') : 'No crew agents configured.')
    },

    async crewStatus(): Promise<TextToolResult> {
      const { hasLiveAgentRun, listAgentRuns } = await import('../agent-runner')
      const runs = listAgentRuns()
      const lines = listAgents().map((agent) => {
        const latest = runs
          .filter((run) => run.agentId === agent.id)
          .sort((a, b) => b.startedAt - a.startedAt)[0]
        if (hasLiveAgentRun(agent.id)) {
          return `${agent.name}: running`
        }
        if (!latest) {
          return `${agent.name}: idle - no runs yet`
        }
        const summary = latest.summary
          ? ` - ${redactSensitiveText(latest.summary).slice(0, 160)}`
          : ''
        return `${agent.name}: idle - last ${latest.status}${summary}`
      })
      return textResult(lines.length > 0 ? lines.join('\n') : 'No crew agents configured.')
    },

    async fileBriefingItem(args: {
      urgency: 'digest' | 'now'
      summary: string
    }): Promise<TextToolResult> {
      const summary = args.summary.trim()
      if (!summary) {
        return errorResult('Briefing summary is required.')
      }
      const item = appendBriefingItem({
        agentId: context.agentId,
        urgency: args.urgency,
        summary
      })
      return textResult(`Briefing item ${item.id} filed with ${args.urgency} urgency.`)
    }
  }
}
