import type { AdamDatabase } from '../db/database.js'
import { TERMINAL_JOB_STATES, type JobState } from '../jobs/states.js'

export type ReconciliationFinding = {
  id: string
  classification: string
  reason: string
}

export type ReconciliationSection = {
  total: number
  classifications: Record<string, number>
  findings: ReconciliationFinding[]
}

export type ReconciliationInventory = {
  generatedAt: string
  jobs: ReconciliationSection
  steps: ReconciliationSection
  sessions: ReconciliationSection
  outbox: ReconciliationSection
  terminalBindings: ReconciliationSection
  workerLaunches: ReconciliationSection
  controls: ReconciliationSection
}

const ACTIVE_SESSION_STATES = new Set(['working', 'waiting'])
const STALE_JOB_MS = 24 * 60 * 60 * 1000
const STALE_SESSION_MS = 60 * 60 * 1000

type JobRow = { id: string; state: string; updated_at: string }
type StepRow = { id: string; job_id: string; state: string; depends_on: string; lease_expires_at: string | null; next_attempt_at: string | null }
type SessionRow = { id: string; provider: string; pane_key: string; state: string; last_seen_at: string; terminal_handle: string | null; worktree_id: string | null; project_id: string | null }
type OutboxRow = { id: string; state: string; next_attempt_at: string; lease_expires_at: string | null }
type TerminalBindingRow = { id: string; state: string; job_id: string | null; project_id: string | null; worktree_id: string }
type WorkerLaunchRow = { id: string; state: string; worktree_id: string | null; terminal_handle: string | null; error: string | null }

export function inventoryReconciliation(db: AdamDatabase, now: Date = new Date()): ReconciliationInventory {
  const jobs = db.prepare('SELECT id, state, updated_at FROM jobs ORDER BY created_at, id').all() as JobRow[]
  const steps = db.prepare('SELECT id, job_id, state, depends_on, lease_expires_at, next_attempt_at FROM steps ORDER BY created_at, id').all() as StepRow[]
  const sessions = db.prepare('SELECT id, provider, pane_key, state, last_seen_at, terminal_handle, worktree_id, project_id FROM sessions ORDER BY first_seen_at, id').all() as SessionRow[]
  const outbox = db.prepare('SELECT id, state, next_attempt_at, lease_expires_at FROM outbox ORDER BY created_at, id').all() as OutboxRow[]
  const terminalBindings = db.prepare('SELECT id, state, job_id, project_id, worktree_id FROM terminal_bindings ORDER BY bound_at, id').all() as TerminalBindingRow[]
  const workerLaunches = db.prepare('SELECT id, state, worktree_id, terminal_handle, error FROM worker_launches ORDER BY created_at, id').all() as WorkerLaunchRow[]
  const jobStates = new Map(jobs.map((job) => [job.id, job.state]))
  const stepStates = new Map(steps.map((step) => [step.id, step.state]))
  const activeSessionIdentities = countActiveSessionIdentities(sessions)

  return {
    generatedAt: now.toISOString(),
    jobs: section(jobs.map((job) => classifyJob(job, now))),
    steps: section(steps.map((step) => classifyStep(step, jobStates, stepStates, now))),
    sessions: section(sessions.map((session) => classifySession(session, activeSessionIdentities, now))),
    outbox: section(outbox.map((item) => classifyOutbox(item, now))),
    terminalBindings: section(terminalBindings.map(classifyTerminalBinding)),
    workerLaunches: section(workerLaunches.map(classifyWorkerLaunch)),
    controls: inventoryControls(db, terminalBindings.length)
  }
}

function classifyJob(job: JobRow, now: Date): ReconciliationFinding {
  if (TERMINAL_JOB_STATES.has(job.state as JobState)) {
    return finding(job.id, job.state, `job is already ${job.state}`)
  }
  if (olderThan(job.updated_at, now, STALE_JOB_MS)) {
    return finding(job.id, 'stale_active', `non-terminal job has not changed since ${job.updated_at}`)
  }
  return finding(job.id, 'active_unverified', `non-terminal job is ${job.state}`)
}

function classifyStep(step: StepRow, jobStates: Map<string, string>, stepStates: Map<string, string>, now: Date): ReconciliationFinding {
  const jobState = jobStates.get(step.job_id)
  if (!jobState) return finding(step.id, 'orphaned_job', `job ${step.job_id} does not exist`)
  if (TERMINAL_JOB_STATES.has(jobState as JobState) && !['completed', 'failed', 'cancelled'].includes(step.state)) {
    return finding(step.id, 'terminal_job_incomplete', `parent job ${step.job_id} is ${jobState}`)
  }
  if (step.state === 'running' && step.lease_expires_at && Date.parse(step.lease_expires_at) <= now.getTime()) {
    return finding(step.id, 'expired_lease', `lease expired at ${step.lease_expires_at}`)
  }
  if (step.state === 'pending' && step.next_attempt_at && Date.parse(step.next_attempt_at) > now.getTime()) {
    return finding(step.id, 'deferred', `next attempt is scheduled for ${step.next_attempt_at}`)
  }
  if (step.state === 'pending') {
    const dependencies = parseDependencies(step.depends_on)
    const incomplete = dependencies.filter((id) => stepStates.get(id) !== 'completed')
    if (incomplete.length) return finding(step.id, 'blocked_dependency', `incomplete dependencies: ${incomplete.join(', ')}`)
    return finding(step.id, 'ready_unclaimed', 'pending step has no unresolved dependencies')
  }
  return finding(step.id, step.state, `step is ${step.state}`)
}

function classifySession(session: SessionRow, activeIdentities: Map<string, number>, now: Date): ReconciliationFinding {
  if (ACTIVE_SESSION_STATES.has(session.state)) {
    const unbound = !session.terminal_handle || !session.worktree_id || !session.project_id
    const stale = olderThan(session.last_seen_at, now, STALE_SESSION_MS)
    const duplicate = (activeIdentities.get(sessionIdentity(session)) ?? 0) > 1
    if (duplicate) return finding(session.id, 'duplicate_active', 'multiple active sessions claim the same provider, pane, and worktree identity')
    if (stale && unbound) return finding(session.id, 'stale_unbound_active', `active session lacks complete identity and has not been observed since ${session.last_seen_at}`)
    if (stale) return finding(session.id, 'stale_active', `active session has not been observed since ${session.last_seen_at}`)
    if (unbound) return finding(session.id, 'unbound_active', 'active session lacks terminal, worktree, or project identity')
  }
  return finding(session.id, session.state, `session is ${session.state}`)
}

function classifyOutbox(item: OutboxRow, now: Date): ReconciliationFinding {
  if (item.state === 'pending' && Date.parse(item.next_attempt_at) <= now.getTime()) {
    return finding(item.id, 'ready_to_retry', `retry was due at ${item.next_attempt_at}`)
  }
  if (item.state === 'pending') return finding(item.id, 'deferred', `retry is scheduled for ${item.next_attempt_at}`)
  if (item.state === 'leased' && (!item.lease_expires_at || Date.parse(item.lease_expires_at) <= now.getTime())) {
    return finding(item.id, 'expired_lease', `outbox lease expired${item.lease_expires_at ? ` at ${item.lease_expires_at}` : ''}`)
  }
  return finding(item.id, item.state, `outbox item is ${item.state}`)
}

function classifyTerminalBinding(binding: TerminalBindingRow): ReconciliationFinding {
  if (binding.state === 'active' && (!binding.job_id || !binding.project_id || !binding.worktree_id)) {
    return finding(binding.id, 'unbound_active', 'active binding lacks job, project, or worktree identity')
  }
  return finding(binding.id, binding.state, `terminal binding is ${binding.state}`)
}

function classifyWorkerLaunch(launch: WorkerLaunchRow): ReconciliationFinding {
  if (launch.error) return finding(launch.id, 'failed', launch.error)
  if (launch.state === 'verified') return finding(launch.id, 'verified', 'worker launch has a verification receipt')
  if (!launch.worktree_id || !launch.terminal_handle) return finding(launch.id, 'incomplete', 'worker launch has not established both worktree and terminal')
  return finding(launch.id, launch.state, `worker launch is ${launch.state}`)
}

export function reconciliationSection(findings: ReconciliationFinding[]): ReconciliationSection {
  const classifications: Record<string, number> = {}
  for (const finding of findings) classifications[finding.classification] = (classifications[finding.classification] ?? 0) + 1
  return { total: findings.length, classifications, findings }
}

export function reconciliationFinding(id: string, classification: string, reason: string): ReconciliationFinding {
  return { id, classification, reason }
}

function section(findings: ReconciliationFinding[]): ReconciliationSection {
  return reconciliationSection(findings)
}

function finding(id: string, classification: string, reason: string): ReconciliationFinding {
  return reconciliationFinding(id, classification, reason)
}

function countActiveSessionIdentities(sessions: SessionRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    if (!ACTIVE_SESSION_STATES.has(session.state)) continue
    const identity = sessionIdentity(session)
    counts.set(identity, (counts.get(identity) ?? 0) + 1)
  }
  return counts
}

function sessionIdentity(session: SessionRow): string {
  return [session.provider, session.pane_key, session.worktree_id ?? ''].join('\u0000')
}

function inventoryControls(db: AdamDatabase, terminalBindingCount: number): ReconciliationSection {
  const findings: ReconciliationFinding[] = []
  const count = (table: string): number => Number(db.prepare(`SELECT count(*) AS total FROM ${table}`).get()?.total ?? 0)
  const approvalCount = count('approvals')
  const evidenceCount = count('evidence')
  const eventCount = count('events')
  if (terminalBindingCount === 0) findings.push(finding('terminal-bindings', 'none_recorded', 'no terminal ownership bindings are recorded'))
  if (approvalCount === 0) findings.push(finding('approvals', 'none_recorded', 'no approval decisions are recorded'))
  if (eventCount > 0 && evidenceCount / eventCount < 0.01) {
    findings.push(finding('event-evidence-ratio', 'evidence_gap', `${evidenceCount} evidence rows exist for ${eventCount} events`))
  }
  return section(findings)
}

function olderThan(value: string, now: Date, thresholdMs: number): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && now.getTime() - parsed > thresholdMs
}

function parseDependencies(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}
