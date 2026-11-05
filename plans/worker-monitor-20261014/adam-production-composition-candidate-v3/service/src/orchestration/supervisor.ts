import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DobiusBundleUnavailableError, type DobiusClient, type DobiusTerminalClient } from '../adapters/dobius.js'
import { CapabilityRegistry } from '../capabilities/registry.js'
import type { AdamDatabase } from '../db/database.js'
import { TERMINAL_JOB_STATES, type JobState } from '../jobs/states.js'
import { JobStore, spokenCompletion } from '../jobs/store.js'
import type { WorkerLauncher } from '../workers/launcher.js'
import type { WorkerPreflightPlanner, WorkerPreflight } from '../workers/preflight.js'
import type { OrchestrationJobRequest } from './contract.js'
import { verifyDefinitionOfDone } from '../verifiers/definition-of-done.js'
import { loadProjectRegistry, type ProjectRegistry } from '../projects/registry.js'
import { resolveContextPack } from '../projects/handshake.js'

type OrchestrationClient = DobiusTerminalClient & Pick<DobiusClient, 'terminalShow' | 'terminalRead'>

const json = (value: unknown): string => JSON.stringify(value)
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T

// States the tick loop drives itself. Human-gated states (awaiting_clarification,
// awaiting_approval, awaiting_external, followup_due) stay excluded so neither the
// periodic sweep nor the startup rescue can auto-execute past an approval gate.
// Terminal states come from jobs/states.ts (reported/cancelled/rolled_back/failed/blocked).
const SWEEPABLE_JOB_STATES = ['received', 'interpreting', 'planning', 'preflight', 'running', 'monitoring', 'recovering', 'verifying'] as const
const SWEEPABLE_JOB_STATES_SQL = SWEEPABLE_JOB_STATES.map((state) => `'${state}'`).join(', ')

const COMPILE_LADDER: Record<string, JobState> = {
  received: 'interpreting',
  interpreting: 'planning',
  planning: 'preflight',
  preflight: 'running'
}

const STARTUP_SWEEP_IDLE_MS = 5 * 60_000
const ORPHAN_PLANNING_IDLE_MS = 24 * 60 * 60_000
const WATCHDOG_STALE_MS = 30 * 60_000
const AWAIT_AGENT_BUDGET_MS = 4 * 60 * 60_000

const OrchestrationAlertsSchema = z.object({
  recipient: z.string().regex(/^\+[1-9]\d{6,14}$/)
})

export type OrchestrationAlertsConfig = z.infer<typeof OrchestrationAlertsSchema>

export function loadOrchestrationAlertsConfig(source: NodeJS.ProcessEnv = process.env): OrchestrationAlertsConfig {
  const parsed = OrchestrationAlertsSchema.safeParse({ recipient: source.ADAM_ALERT_RECIPIENT })
  if (!parsed.success) {
    throw new Error('ADAM_ALERT_RECIPIENT must be set to an E.164 phone number (for example +17344784716); orchestration alerts have no destination')
  }
  return parsed.data
}

export class AuthoritativeOrchestrationSupervisor {
  private readonly jobs: JobStore
  private readonly capabilities: CapabilityRegistry
  private readonly active = new Set<string>()

  constructor(
    private readonly db: AdamDatabase,
    private readonly preflight: WorkerPreflightPlanner,
    private readonly launcher: WorkerLauncher,
    private readonly dobius: OrchestrationClient,
    private readonly alerts: OrchestrationAlertsConfig = loadOrchestrationAlertsConfig(),
    // Budget intent from ServiceOptions; recorded on the launch row, never
    // silently dropped. Interactive sessions cannot enforce it (verified:
    // --max-budget-usd requires --print), so this is declaration only.
    private readonly launchOptions: { maxBudgetUsd?: number } = {},
    // The canonical project registry. Optional with a real default so the
    // out-of-scope replay-command.ts construction still compiles, but the launch
    // step ALWAYS resolves a context pack from it before a worker is launched —
    // the same gate that stops a worker being launched into a read_only project.
    private readonly registry: ProjectRegistry = loadProjectRegistry()
  ) {
    this.jobs = new JobStore(db)
    this.capabilities = new CapabilityRegistry(db)
    queueMicrotask(() => {
      this.startupSweep().catch((error: unknown) => {
        process.stderr.write(`adam orchestration startup sweep failed: ${error instanceof Error ? error.stack : String(error)}\n`)
      })
    })
  }

  compile(request: OrchestrationJobRequest): { commandId: string; jobId: string; created: boolean } {
    const command = this.jobs.acceptCommand({ channel: request.authorization.source, senderId: 'carson', dedupeKey: request.dedupeKey, body: request.objective })
    if (!command.created) {
      const prior = this.db.prepare('SELECT id FROM jobs WHERE command_id=? ORDER BY created_at LIMIT 1').get(command.id) as { id: string } | undefined
      if (!prior) throw new Error('duplicate command has no job')
      return { commandId: command.id, jobId: prior.id, created: false }
    }
    const jobId = this.jobs.createJob({ commandId: command.id, objective: request.objective, risk: 'medium', definitionOfDone: request.definitionOfDone })
    const at = new Date().toISOString()
    // Persist the RESOLVED readiness into the stored contract so execute()'s
    // raw-contract read finds it. Explicit caller values always win; otherwise
    // fall back to the latest fresh doctor measurement for this agentType, or
    // leave it absent (launcher then fails closed to restricted).
    const storedRequest = this.resolveContractReadiness(request)
    this.db.prepare('INSERT INTO orchestration_job_contracts (job_id,contract,created_at,updated_at) VALUES (?,?,?,?)')
      .run(jobId, json(storedRequest), at, at)
    this.jobs.transitionJob(jobId, 'interpreting', { compiler: 'universal-v1' })
    this.jobs.transitionJob(jobId, 'planning', { algorithm: 'required' })
    this.jobs.transitionJob(jobId, 'preflight', { authority: request.authorization })
    const preflight = this.jobs.addStep({ jobId, title: 'Resolve project and preflight workspace', adapter: 'dobius.worker_preflight', payload: { repoSelector: request.repoSelector } })
    const launch = this.jobs.addStep({ jobId, title: 'Create terminal and launch agent', adapter: 'dobius.worker_launch', dependsOn: [preflight], payload: {} })
    let dependencies = [launch]
    if (request.monitor) {
      const awaitAgent = this.jobs.addStep({ jobId, title: 'Await verified agent outcome', adapter: 'dobius.await_agent', dependsOn: dependencies, payload: {} })
      dependencies = [awaitAgent]
    }
    if (request.asanaDraft) {
      const draft = this.jobs.addStep({ jobId, title: 'Prepare Asana update draft', adapter: 'local.asana_draft', dependsOn: dependencies, payload: request.asanaDraft })
      dependencies = [draft]
    }
    this.jobs.addStep({ jobId, title: 'Verify parent outcome', adapter: 'verify.orchestration', dependsOn: dependencies, payload: {} })
    this.jobs.transitionJob(jobId, 'running', { compiled: true })
    return { commandId: command.id, jobId, created: true }
  }

  async tickAll(limit = 5): Promise<Array<{ jobId: string; outcome: string }>> {
    const rows = this.db.prepare(
      `SELECT id FROM jobs WHERE state IN (${SWEEPABLE_JOB_STATES_SQL})
       AND EXISTS (SELECT 1 FROM orchestration_job_contracts c WHERE c.job_id = jobs.id)
       ORDER BY updated_at LIMIT ?`
    ).all(limit) as unknown as Array<{ id: string }>
    const results: Array<{ jobId: string; outcome: string }> = []
    for (const row of rows) results.push({ jobId: row.id, outcome: await this.tick(row.id) })
    return results
  }

  async startupSweep(limit = 50): Promise<Array<{ jobId: string; action: string }>> {
    // Contract-less planning jobs (e.g. gateway-routed messages) have no
    // executor to advance them, so the contract-scoped rescue below never sees
    // them and they hang forever. Expire the stale ones first. This block is
    // fully synchronous so the constructor's auto-sweep microtask cannot race a
    // manual startupSweep before it runs.
    const rescued: Array<{ jobId: string; action: string }> = []
    const orphanCutoff = new Date(Date.now() - ORPHAN_PLANNING_IDLE_MS).toISOString()
    const orphans = this.db.prepare(
      `SELECT j.id FROM jobs j
       WHERE j.state = 'planning'
         AND NOT EXISTS (SELECT 1 FROM orchestration_job_contracts c WHERE c.job_id = j.id)
         AND j.updated_at <= ?
         AND COALESCE((SELECT MAX(s.updated_at) FROM steps s WHERE s.job_id = j.id), j.updated_at) <= ?
       ORDER BY j.updated_at LIMIT ?`
    ).all(orphanCutoff, orphanCutoff, limit) as unknown as Array<{ id: string }>
    for (const row of orphans) {
      this.failOrphan(row.id)
      rescued.push({ jobId: row.id, action: 'orphaned-no-executor' })
    }

    const cutoff = new Date(Date.now() - STARTUP_SWEEP_IDLE_MS).toISOString()
    const rows = this.db.prepare(
      `SELECT j.id, j.state FROM jobs j
       WHERE j.state IN (${SWEEPABLE_JOB_STATES_SQL})
         AND EXISTS (SELECT 1 FROM orchestration_job_contracts c WHERE c.job_id = j.id)
         AND j.updated_at <= ?
         AND COALESCE((SELECT MAX(s.updated_at) FROM steps s WHERE s.job_id = j.id), j.updated_at) <= ?
       ORDER BY j.updated_at LIMIT ?`
    ).all(cutoff, cutoff, limit) as unknown as Array<{ id: string; state: string }>
    for (const row of rows) {
      const before = String(row.state)
      const outcome = await this.tick(row.id)
      const after = String(this.jobs.getJob(row.id)?.state ?? before)
      if (outcome === 'waiting' && !TERMINAL_JOB_STATES.has(after as JobState)) {
        this.failJob(row.id, `Startup sweep found this job orphaned in state '${before}' with no progress possible.`)
        rescued.push({ jobId: row.id, action: 'failed' })
        continue
      }
      rescued.push({ jobId: row.id, action: outcome === 'already_ticking' ? 'skipped' : outcome })
    }
    return rescued
  }

  async tick(jobId: string): Promise<string> {
    if (this.active.has(jobId)) return 'already_ticking'
    this.active.add(jobId)
    const worker = `orchestrator:${jobId}`
    try {
      const job = this.jobs.getJob(jobId)
      if (!job) throw new Error('job not found')
      const owned = this.db.prepare('SELECT 1 AS owned FROM orchestration_job_contracts WHERE job_id=?').get(jobId)
      if (!owned) return `foreign:${job.state}`
      const state = String(job.state)
      if (TERMINAL_JOB_STATES.has(state as JobState)) return `terminal:${state}`
      if (!(SWEEPABLE_JOB_STATES as readonly string[]).includes(state)) return `unscheduled:${state}`
      this.watchdog(jobId, String(job.updated_at))
      let cursor = state
      while (COMPILE_LADDER[cursor]) {
        const next = COMPILE_LADDER[cursor]!
        this.jobs.transitionJob(jobId, next, { rescue: 'tick-normalization' })
        cursor = next
      }
      if (String(this.jobs.getJob(jobId)?.state) === 'recovering') this.jobs.transitionJob(jobId, 'running', { retry: true })
      const step = this.jobs.claimReadyStepForJob(jobId, worker, 120_000)
      if (!step) return 'waiting'
      try {
        const outcome = await this.execute(jobId, step)
        if (outcome.kind === 'deferred') {
          if (String(step.adapter) === 'dobius.await_agent' && Date.now() - Date.parse(String(step.created_at)) >= AWAIT_AGENT_BUDGET_MS) {
            this.jobs.failStepForced(String(step.id), worker, 'await_agent_budget_exceeded', { budgetMs: AWAIT_AGENT_BUDGET_MS, lastReceipt: outcome.receipt })
            this.failJob(jobId, `The await-agent step exceeded its ${AWAIT_AGENT_BUDGET_MS / 3_600_000} hour time budget without a verified outcome.`)
            return 'failed'
          }
          this.jobs.deferStep(String(step.id), worker, new Date(Date.now() + outcome.delayMs), outcome.receipt)
          if (this.jobs.getJob(jobId)?.state === 'running') this.jobs.transitionJob(jobId, 'monitoring', { step: step.title })
          return 'deferred'
        }
        this.jobs.completeStep(String(step.id), worker, outcome.receipt)
        if (String(step.adapter) === 'verify.orchestration') {
          if (this.jobs.getJob(jobId)?.state === 'monitoring') this.jobs.transitionJob(jobId, 'running', { verificationReady: true })
          this.jobs.transitionJob(jobId, 'verifying', outcome.receipt)
          this.jobs.transitionJob(jobId, 'completed', outcome.receipt)
          this.jobs.transitionJob(jobId, 'reported', { evidence: 'orchestration-verifier' })
          const contract = this.contract(jobId)
          this.jobs.enqueueOutbox({
            dedupeKey: `orchestration:${jobId}:reported`, channel: 'imessage', recipient: this.alerts.recipient,
            payload: { text: `Verified complete: ${contract.objective}${contract.asanaDraft ? ' The Asana update is prepared as a draft and still requires your exact approval.' : ''}`, jobId }
          })
          if (this.commandChannel(jobId) === 'voice') {
            this.jobs.enqueueOutbox({
              dedupeKey: `orchestration:${jobId}:reported:tts`, channel: 'tts', recipient: this.alerts.recipient,
              payload: { text: spokenCompletion({ outcome: 'done', objective: contract.objective }), jobId }
            })
          }
          return 'reported'
        }
        return 'advanced'
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof DobiusBundleUnavailableError) {
          this.jobs.deferStep(String(step.id), worker, new Date(Date.now() + error.retryAfterMs), {
            transient: true, code: error.code, message
          })
          const state = String(this.jobs.getJob(jobId)?.state)
          if (state === 'running') this.jobs.transitionJob(jobId, 'monitoring', { waitingFor: 'dobius_bundle', message })
          return 'deferred'
        }
        this.jobs.failStep(String(step.id), worker, 'executor_error', { message })
        const failed = this.db.prepare('SELECT state FROM steps WHERE id=?').get(String(step.id)) as { state: string }
        if (failed.state === 'failed') {
          this.failJob(jobId, `Bounded retries exhausted: ${message}`)
          return 'failed'
        }
        const state = String(this.jobs.getJob(jobId)?.state)
        if (state === 'monitoring') this.jobs.transitionJob(jobId, 'recovering', { message })
        else if (state === 'running') this.jobs.transitionJob(jobId, 'recovering', { message })
        return 'recovering'
      }
    } finally { this.active.delete(jobId) }
  }

  async cancel(jobId: string, reason: string): Promise<{ cancelled: boolean; terminalStopped: boolean }> {
    const job = this.jobs.getJob(jobId)
    if (!job) throw new Error('job not found')
    if (['reported', 'completed', 'cancelled', 'failed'].includes(String(job.state))) return { cancelled: false, terminalStopped: false }
    const launch = this.db.prepare("SELECT result FROM steps WHERE job_id=? AND adapter='dobius.worker_launch' AND state='completed'").get(jobId) as { result: string } | undefined
    let terminalStopped = false
    const handle = launch ? (parse<{ terminalHandle?: string }>(launch.result).terminalHandle ?? null) : null
    if (handle && this.dobius.terminalClose) {
      await this.dobius.terminalClose(handle)
      terminalStopped = true
    }
    this.db.prepare("UPDATE steps SET state='cancelled',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND state NOT IN ('completed','failed')")
      .run(new Date().toISOString(), jobId)
    this.jobs.transitionJob(jobId, 'cancelled', { reason, terminalStopped })
    this.db.prepare('UPDATE jobs SET cancellation_reason=?,cancelled_at=? WHERE id=?').run(reason, new Date().toISOString(), jobId)
    return { cancelled: true, terminalStopped }
  }

  status(jobId: string): Record<string, unknown> {
    const job = this.jobs.getJob(jobId)
    if (!job) throw new Error('job not found')
    const steps = this.db.prepare('SELECT id,title,adapter,state,attempt_count,max_attempts,result,error_class,next_attempt_at FROM steps WHERE job_id=? ORDER BY created_at').all(jobId)
    const evidence = this.db.prepare('SELECT verifier,source,result,created_at FROM evidence WHERE job_id=? ORDER BY created_at').all(jobId)
    return { job, steps, evidence }
  }

  private watchdog(jobId: string, jobUpdatedAt: string): void {
    const now = Date.now()
    const jobAgeMs = now - Date.parse(jobUpdatedAt)
    const latestStep = this.db.prepare('SELECT MAX(updated_at) AS at FROM steps WHERE job_id=?').get(jobId) as { at: string | null }
    const stepAgeMs = latestStep.at ? now - Date.parse(latestStep.at) : Number.MAX_SAFE_INTEGER
    if (jobAgeMs < WATCHDOG_STALE_MS || stepAgeMs < WATCHDOG_STALE_MS) return
    this.jobs.enqueueOutbox({
      dedupeKey: `orchestration:${jobId}:stale-watchdog`, channel: 'imessage', recipient: this.alerts.recipient,
      payload: { text: `ADAM watchdog: job ${jobId} (${this.safeObjective(jobId)}) has made no progress in ${Math.round(jobAgeMs / 60_000)} minutes and is still unresolved.`, jobId }
    })
  }

  // Expire a contract-less planning orphan. No imessage alert on purpose: these
  // are junk from the now-fixed mint-on-approval bug, and one text per orphan
  // would spam Carson. The reason is recorded as evidence for the audit trail.
  private failOrphan(jobId: string): void {
    this.db.prepare("UPDATE jobs SET state='failed',updated_at=? WHERE id=?").run(new Date().toISOString(), jobId)
    this.jobs.recordEvidence({ jobId, verifier: 'startup-sweep', source: 'jobs', result: { passed: false, reason: 'orphaned-no-executor' } })
  }

  private failJob(jobId: string, reason: string): void {
    this.db.prepare("UPDATE jobs SET state='failed',updated_at=? WHERE id=?").run(new Date().toISOString(), jobId)
    this.jobs.enqueueOutbox({
      dedupeKey: `orchestration:${jobId}:failed`, channel: 'imessage', recipient: this.alerts.recipient,
      payload: { text: `ADAM job failed: ${this.safeObjective(jobId)}. ${reason}`, jobId }
    })
    if (this.commandChannel(jobId) === 'voice') {
      this.jobs.enqueueOutbox({
        dedupeKey: `orchestration:${jobId}:failed:tts`, channel: 'tts', recipient: this.alerts.recipient,
        payload: { text: spokenCompletion({ outcome: 'failed', objective: this.safeObjective(jobId), error: reason }), jobId }
      })
    }
  }

  private commandChannel(jobId: string): string | null {
    try {
      const authorization = this.rawContract(jobId).authorization
      if (!authorization || typeof authorization !== 'object') return null
      const source = (authorization as Record<string, unknown>).source
      return typeof source === 'string' ? source : null
    } catch {
      return null
    }
  }

  private safeObjective(jobId: string): string {
    try {
      return this.contract(jobId).objective
    } catch (error) {
      return `(contract unavailable: ${error instanceof Error ? error.message : String(error)})`
    }
  }

  private resolveContractReadiness(request: OrchestrationJobRequest): OrchestrationJobRequest {
    if (request.readinessLevel !== undefined) return request
    // select() excludes expired checks even at minLevel 0, so a stale
    // measurement falls through to undefined rather than an old green.
    const measured = this.capabilities
      .select('worker_launch', 0)
      .find((item) => item.adapter === request.agentType)
    return measured ? { ...request, readinessLevel: measured.level } : request
  }

  private contract(jobId: string): OrchestrationJobRequest {
    const row = this.db.prepare('SELECT contract FROM orchestration_job_contracts WHERE job_id=?').get(jobId) as { contract: string }
    return parse<OrchestrationJobRequest>(row.contract)
  }

  private rawContract(jobId: string): Record<string, unknown> {
    const row = this.db.prepare('SELECT contract FROM orchestration_job_contracts WHERE job_id=?').get(jobId) as { contract: string }
    return parse<Record<string, unknown>>(row.contract)
  }

  private stepResult<T>(jobId: string, adapter: string): T {
    const row = this.db.prepare('SELECT result FROM steps WHERE job_id=? AND adapter=? AND state=\'completed\'').get(jobId, adapter) as { result: string } | undefined
    if (!row) throw new Error(`missing completed dependency: ${adapter}`)
    return parse<T>(row.result)
  }

  private async execute(jobId: string, step: Record<string, unknown>): Promise<{ kind: 'completed'; receipt: unknown } | { kind: 'deferred'; delayMs: number; receipt: unknown }> {
    const request = this.contract(jobId)
    switch (String(step.adapter)) {
      case 'dobius.worker_preflight': {
        const result = await this.preflight.plan({ repoSelector: request.repoSelector })
        return { kind: 'completed', receipt: result }
      }
      case 'dobius.worker_launch': {
        const preflight = this.stepResult<WorkerPreflight>(jobId, 'dobius.worker_preflight')
        const readinessRaw = this.rawContract(jobId).readinessLevel
        const readinessLevel = typeof readinessRaw === 'number' && Number.isFinite(readinessRaw) ? readinessRaw : undefined
        // Fail closed: resolve the context pack from the repo's observed path
        // before any worker is launched. A refusal throws and fails the step
        // rather than launching into a read_only project. Readiness enforcement
        // stays with the launcher (resolveLaunchToolPolicy), so it is not passed
        // here — the handshake gates the project, the launcher gates readiness.
        const pack = resolveContextPack({
          registry: this.registry, worktreePath: preflight.repo.path, intent: 'launch'
        })
        const result = await this.launcher.launch({
          idempotencyKey: `orchestration:${jobId}:launch`, preflight, worktreeName: request.worktreeName,
          agentType: request.agentType, promptSource: { jobId, objective: request.objective, prompt: request.prompt },
          contextPack: { digest: pack.digest, json: JSON.stringify(pack) },
          buildPrompt: (target) => this.workerPrompt(request, jobId, target), setupPolicy: request.setupPolicy,
          authorizedBy: 'carson', authorizationSource: request.authorization.source,
          ...(readinessLevel !== undefined ? { readinessLevel } : {}),
          ...(this.launchOptions.maxBudgetUsd !== undefined ? { maxBudgetUsd: this.launchOptions.maxBudgetUsd } : {})
        })
        return { kind: 'completed', receipt: result }
      }
      case 'dobius.await_agent': {
        const launch = this.stepResult<{ terminalHandle: string }>(jobId, 'dobius.worker_launch')
        const shown = await this.dobius.terminalShow(launch.terminalHandle)
        const read = await this.dobius.terminalRead(launch.terminalHandle, 120)
        const paneKey = typeof shown.terminal.paneKey === 'string' ? shown.terminal.paneKey
          : typeof shown.terminal.tabId === 'string' && typeof shown.terminal.leafId === 'string' ? `${shown.terminal.tabId}:${shown.terminal.leafId}` : null
        const session = paneKey ? this.db.prepare('SELECT state,last_assistant_message FROM sessions WHERE pane_key=? ORDER BY last_seen_at DESC LIMIT 1').get(paneKey) as { state: string; last_assistant_message: string | null } | undefined : undefined
        const state = String(read.terminal.state ?? shown.terminal.state ?? session?.state ?? 'unknown')
        if (state === 'blocked' || state === 'failed') throw new Error(`agent ${state}: ${session?.last_assistant_message ?? 'no detail'}`)
        if (state !== 'done') return { kind: 'deferred', delayMs: 15_000, receipt: { state, terminalHandle: launch.terminalHandle } }
        return { kind: 'completed', receipt: { state, terminalHandle: launch.terminalHandle, result: session?.last_assistant_message ?? (read.terminal.tail ?? []).join('\n') } }
      }
      case 'local.asana_draft':
        return { kind: 'completed', receipt: { draftOnly: true, ...request.asanaDraft, approvalRequired: true } }
      case 'verify.orchestration': {
        const incomplete = Number(this.db.prepare("SELECT COUNT(*) AS n FROM steps WHERE job_id=? AND id!=? AND state!='completed'").get(jobId, String(step.id))?.n ?? 0)
        const launch = this.stepResult<{ state: string; terminalHandle: string }>(jobId, 'dobius.worker_launch')
        // Delivery stays a prerequisite; it is no longer the whole test. A job
        // only reports if the worker's own evidence also satisfies the DoD.
        const delivered = incomplete === 0 && launch.state === 'verified' && Boolean(launch.terminalHandle)
        const dod = request.definitionOfDone ?? []
        const dodCheck = delivered && dod.length > 0
          ? verifyDefinitionOfDone(dod, await this.workerEvidence(jobId, launch.terminalHandle))
          : undefined
        const passed = delivered && (dodCheck?.passed ?? true)
        const receipt = {
          passed, incomplete, launchVerified: launch.state === 'verified', terminalHandle: launch.terminalHandle,
          definitionOfDone: dod,
          ...(dodCheck ? { definitionOfDoneMet: dodCheck.met, definitionOfDoneUnmet: dodCheck.unmet } : {})
        }
        this.jobs.recordEvidence({ jobId, stepId: String(step.id), verifier: 'orchestration-verifier', source: 'steps+worker_launches+dobius', result: receipt })
        if (!passed) throw new Error(`orchestration verification failed: ${json(receipt)}`)
        return { kind: 'completed', receipt }
      }
      default: throw new Error(`unsupported orchestration adapter: ${step.adapter}`)
    }
  }

  // Read the worker's own output as DoD evidence: prefer the await_agent
  // receipt (already the verified outcome) when present, otherwise read the
  // launched terminal directly so monitor:false jobs still produce evidence.
  private async workerEvidence(jobId: string, terminalHandle: string): Promise<string> {
    const awaited = this.db.prepare("SELECT result FROM steps WHERE job_id=? AND adapter='dobius.await_agent' AND state='completed'").get(jobId) as { result: string } | undefined
    if (awaited) {
      const captured = parse<{ result?: string }>(awaited.result)
      if (typeof captured.result === 'string' && captured.result.length > 0) return captured.result
    }
    const read = await this.dobius.terminalRead(terminalHandle, 200)
    const tail = read.terminal.tail
    return Array.isArray(tail) ? tail.join('\n') : ''
  }

  private workerPrompt(request: OrchestrationJobRequest, jobId: string, target: { worktreeId: string; worktreePath: string; terminalHandle: string }): string {
    const digest = createHash('sha256').update(request.prompt).digest('hex')
    const dod = request.definitionOfDone ?? []
    const dodBlock = dod.length > 0 ? dod.map((item) => `- ${item}`).join('\n') : '- (none specified)'
    return `ROLE\nYou are the execution worker for ADAM orchestration job ${jobId}.\n\nOBJECTIVE\n${request.objective}\n\nEXACT TARGET\nWorktree: ${target.worktreeId}\nPath: ${target.worktreePath}\nTerminal: ${target.terminalHandle}\n\nTASK\n${request.prompt}\n\nDEFINITION OF DONE\n${dodBlock}\n\nAUTHORITY\nLocal read/edit/test only. Do not push, merge, deploy, spend money, or contact external people.\n\nVERIFICATION\nRun relevant checks and report concrete evidence.\n\nESCALATION\nStop and report blockers or target ambiguity.\n\nFAIL SAFE\nDo not claim completion without evidence. Prompt digest: ${digest}`
  }
}
