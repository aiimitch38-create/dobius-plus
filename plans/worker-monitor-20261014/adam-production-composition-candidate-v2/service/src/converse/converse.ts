import { createHash } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'
import { TERMINAL_JOB_STATES } from '../jobs/states.js'
import { HEARTBEAT_CHANNELS } from '../health/channel-heartbeat.js'
import { classifyIMessageModel } from '../models/imessage-classifier.js'
import type { OrchestrationJobRequest } from '../orchestration/contract.js'
import { defaultProjectRegistryPath, loadProjectRegistry, normalizeProjectAlias, type ProjectManifest } from '../projects/registry.js'

export type ConverseAnswer = { kind: 'answer'; text: string }
export type ConverseJob = { kind: 'job'; jobId: string; created: boolean; text: string }
export type ConverseResult = ConverseAnswer | ConverseJob

export type ConverseDeps = {
  db: AdamDatabase
  compile(request: OrchestrationJobRequest): { commandId: string; jobId: string; created: boolean }
  projectRegistryPath?: string
}

export const CONVERSE_DEFINITION_OF_DONE = [
  'Worker launched in isolated worktree',
  'Outcome verified with concrete evidence'
]

const MAX_UTTERANCE_CHARS = 2000

// Status/question intents are matched FIRST so cheap deterministic facts win
// over any work-request heuristic ("what's left in cologne" answers, never compiles).
const STATUS_QUESTION_PATTERNS: readonly RegExp[] = [
  /\bwhat'?s left\b/i,
  /\bstatus\b/i,
  /\bhow many jobs\b/i,
  /\bwhat(?:'s| are) you working on\b/i,
  /\banything (?:left|open|pending)\b/i
]

// Reuses the imessage-classifier's pure feature extractor: an execution or
// delegation phrase signals Carson wants work done, not conversation.
const WORK_INTENT_FEATURES = new Set(['execution_verb', 'delegation_phrase'])

export function handleUtterance(rawUtterance: string, deps: ConverseDeps): ConverseResult {
  const utterance = rawUtterance.trim()
  if (!utterance || utterance.length > MAX_UTTERANCE_CHARS) {
    throw new Error(`utterance must contain 1-${MAX_UTTERANCE_CHARS} characters`)
  }
  if (STATUS_QUESTION_PATTERNS.some((pattern) => pattern.test(utterance))) {
    return { kind: 'answer', text: statusAnswer(deps.db) }
  }
  if (isWorkRequest(utterance)) {
    return workRequest(utterance, deps)
  }
  return {
    kind: 'answer',
    text: 'I did not catch a request there. Ask me for a status update, or say what to do and name the project.'
  }
}

const TERMINAL_JOB_STATES_SQL = [...TERMINAL_JOB_STATES].map((state) => `'${state}'`).join(', ')

function statusAnswer(db: AdamDatabase): string {
  const activeRows = db.prepare(
    `SELECT state, count(*) AS n FROM jobs WHERE state NOT IN (${TERMINAL_JOB_STATES_SQL}) GROUP BY state ORDER BY n DESC, state`
  ).all() as Array<{ state: string; n: number }>
  const activeTotal = activeRows.reduce((sum, row) => sum + Number(row.n), 0)
  const first = activeTotal === 0
    ? 'Nothing is in flight.'
    : `You have ${activeTotal} job${activeTotal === 1 ? '' : 's'} in flight: ${activeRows.map((row) => `${row.n} ${row.state}`).join(', ')}.`
  const completed = db.prepare(
    'SELECT objective FROM jobs WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1'
  ).get() as { objective: string } | undefined
  const second = completed ? ` Most recently finished: ${clipSpoken(completed.objective)}.` : ''
  // Same SQL runtime/service.ts uses for the heartbeat snapshot.
  const third = ` Channels: ${HEARTBEAT_CHANNELS.map((channel) => `${channel} ${lastDeliveredPhrase(db, channel)}`).join(', ')}.`
  return `${first}${second}${third}`
}

function lastDeliveredPhrase(db: AdamDatabase, channel: string): string {
  const row = db.prepare(
    "SELECT MAX(COALESCE(sent_at, delivered_at)) AS t FROM outbox WHERE channel = ? AND state = 'delivered'"
  ).get(channel) as { t: string | null }
  return row.t ? `last delivered ${relativeAge(row.t)}` : 'never delivered'
}

function relativeAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 90_000) return 'just now'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 90) return `${minutes}m ago`
  const hours = Math.round(ms / 3_600_000)
  if (hours < 36) return `${hours}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

function clipSpoken(text: string, max = 120): string {
  const cleaned = text.replace(/[*_`#>[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  const match = cleaned.match(/^([\s\S]*?[.!?])(?:\s|$)/)
  const sentence = (match ? match[1]! : cleaned).replace(/[.!?]+$/, '').trim()
  if (sentence.length <= max) return sentence
  const cut = sentence.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trim()
}

function isWorkRequest(utterance: string): boolean {
  return classifyIMessageModel(utterance).features.some((feature) => WORK_INTENT_FEATURES.has(feature))
}

type ProjectResolution =
  | { status: 'resolved'; project: ProjectManifest }
  | { status: 'ask'; text: string }

function resolveProject(utterance: string, projects: ProjectManifest[]): ProjectResolution {
  const lowered = utterance.toLowerCase()
  const mentioned = projects.filter((project) => project.aliases.some((alias) =>
    new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(normalizeProjectAlias(alias))}(?:$|[^a-z0-9])`).test(lowered)
  ))
  const runnable = projects.filter((project) => project.execution.mode === 'managed')
  if (mentioned.length === 1) {
    const project = mentioned[0]!
    if (project.execution.mode !== 'managed') {
      return { status: 'ask', text: `${project.name} is registered ${project.execution.mode}; managed launches remain disabled until its authority mode is explicitly changed.` }
    }
    return { status: 'resolved', project }
  }
  if (mentioned.length > 1) {
    return { status: 'ask', text: `That matches several projects: ${mentioned.map((project) => project.name).sort().join(', ')}. Which one?` }
  }
  if (runnable.length === 1) {
    return { status: 'resolved', project: runnable[0]! }
  }
  if (runnable.length === 0) {
    return { status: 'ask', text: `No runnable projects are registered; add a verified managed entry to ${defaultProjectRegistryPath()}.` }
  }
  return { status: 'ask', text: `Which project? Runnable projects: ${runnable.map((project) => project.name).sort().join(', ')}.` }
}

function workRequest(utterance: string, deps: ConverseDeps): ConverseResult {
  const registry = loadProjectRegistry(deps.projectRegistryPath ?? defaultProjectRegistryPath())
  const resolution = resolveProject(utterance, registry.projects)
  if (resolution.status === 'ask') return { kind: 'answer', text: resolution.text }
  const project = resolution.project
  const minuteBucket = Math.floor(Date.now() / 60_000)
  const digest = createHash('sha256').update(`${utterance}:${minuteBucket}`).digest('hex').slice(0, 10)
  const request: OrchestrationJobRequest = {
    senderId: 'carson',
    dedupeKey: `converse:${digest}`,
    objective: utterance,
    repoSelector: project.execution.repoSelector!,
    worktreeName: `${slugify(project.id)}-${digest}`,
    agentType: 'codex',
    setupPolicy: 'inherit',
    prompt: utterance.length >= 10 ? utterance : `Voice request from Carson: ${utterance}`,
    monitor: true,
    definitionOfDone: [...CONVERSE_DEFINITION_OF_DONE],
    authorization: { authorizedBy: 'carson', approved: true, source: 'voice' }
  }
  const compiled = deps.compile(request)
  return {
    kind: 'job',
    jobId: compiled.jobId,
    created: compiled.created,
    text: `On it: starting a job on ${project.name} to ${lowerFirst(clipSpoken(utterance))}. Tracking ${compiled.jobId.slice(0, 8)}.`
  }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Mirrors adam-submit.ts slugify so worktree names look identical from either entry point.
function slugify(input: string): string {
  const slug = input.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return /^[a-z0-9]/.test(slug) ? slug : `j-${slug}`
}
