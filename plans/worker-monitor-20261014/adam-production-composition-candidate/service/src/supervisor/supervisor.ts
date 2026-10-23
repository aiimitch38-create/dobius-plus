import type { AdamDatabase } from '../db/database.js'
import { JobStore } from '../jobs/store.js'
import { buildExecutiveBrief, type ExecutiveBrief } from '../intelligence/executive-brief.js'
import { extractCommitmentCandidates } from '../intelligence/commitments.js'
import { importMarkdownCommitments } from '../intelligence/import-commitments.js'
import type { SessionAwareness } from '../sessions/awareness.js'
import { verifyExecutiveBrief } from '../verifiers/executive-brief.js'
import { chooseBestSafePlan, type CandidatePlan } from './planner.js'

export type SupervisorResult = {
  commandId: string
  jobId: string
  brief: ExecutiveBrief
  selectedPlan: string
}

export class AdamSupervisor {
  private readonly jobs: JobStore

  constructor(
    private readonly db: AdamDatabase,
    private readonly awareness: SessionAwareness,
    private readonly commitmentsPath?: string
  ) {
    this.jobs = new JobStore(db)
  }

  async prepareTomorrow(input: {
    channel: string
    senderId: string
    dedupeKey: string
    commandText?: string
  }): Promise<SupervisorResult> {
    const command = this.jobs.acceptCommand({
      channel: input.channel,
      senderId: input.senderId,
      dedupeKey: input.dedupeKey,
      body: input.commandText ?? 'ADAM, get me ready for tomorrow.'
    })
    if (!command.created) {
      const existing = this.db.prepare('SELECT id FROM jobs WHERE command_id = ? ORDER BY created_at LIMIT 1')
        .get(command.id) as { id: string } | undefined
      if (existing) {
        const evidence = this.db.prepare(`
          SELECT result FROM evidence WHERE job_id = ? AND verifier = 'executive-brief-verifier' ORDER BY created_at DESC LIMIT 1
        `).get(existing.id) as { result: string } | undefined
        if (evidence) {
          const parsed = JSON.parse(evidence.result) as { brief: ExecutiveBrief; selectedPlan: string }
          return { commandId: command.id, jobId: existing.id, ...parsed }
        }
      }
      throw new Error('Duplicate command exists but its prior result is unavailable')
    }

    const jobId = this.jobs.createJob({
      commandId: command.id,
      objective: 'Prepare Carson for tomorrow using all current project and commitment evidence.',
      risk: 'low',
      definitionOfDone: {
        awarenessReconciled: true,
        commitmentsExtracted: true,
        attentionRanked: true,
        receiptsIncluded: true
      }
    })
    this.jobs.transitionJob(jobId, 'interpreting')
    this.jobs.transitionJob(jobId, 'planning')

    const plans: CandidatePlan[] = [
      {
        id: 'read-only-live-reconcile',
        summary: 'Refresh live Dobius state, extract candidate commitments, and prepare a sourced brief without external changes.',
        cost: 0.25,
        risk: 0.05,
        reversibility: 1,
        confidence: 0.9,
        policyFit: 1,
        algorithm: this.algorithmReview('Refresh live evidence before briefing', 'Carson', 'Without it, the brief can contain stale project state.', 'Reuse the existing Dobius reconciliation adapter.')
      },
      {
        id: 'reuse-stale-ledger',
        summary: 'Prepare the brief from existing stored state only.',
        cost: 0.05,
        risk: 0.35,
        reversibility: 1,
        confidence: 0.45,
        policyFit: 1,
        algorithm: this.algorithmReview('Use stored state without refreshing it', 'ADAM', 'Without it, nothing breaks because the live-read plan supersedes it.', 'Reuse the existing database query.')
      },
      {
        id: 'autonomous-rescheduling',
        summary: 'Refresh state and move calendar events automatically.',
        cost: 0.5,
        risk: 0.7,
        reversibility: 0.6,
        confidence: 0.5,
        policyFit: 0,
        algorithm: this.algorithmReview('Move calendar events without exact approval', 'ADAM', 'Without it, no authorized outcome is lost; Carson retains control.', 'Do not implement this path.')
      }
    ]
    const selected = chooseBestSafePlan(plans)
    this.jobs.transitionJob(jobId, 'preflight', { selectedPlan: selected })

    const awarenessStep = this.jobs.addStep({ jobId, title: 'Reconcile Dobius awareness', adapter: 'dobius.read' })
    const commitmentStep = this.jobs.addStep({
      jobId,
      title: 'Extract commitment candidates',
      adapter: 'intelligence.commitments',
      dependsOn: [awarenessStep]
    })
    const briefStep = this.jobs.addStep({
      jobId,
      title: 'Build attention-ranked executive brief',
      adapter: 'intelligence.brief',
      dependsOn: [commitmentStep]
    })
    this.jobs.transitionJob(jobId, 'running')
    const worker = `supervisor:${jobId}`

    const first = this.jobs.claimReadyStep(worker, 60_000)
    if (first?.id !== awarenessStep) throw new Error('Awareness step was not ready')
    const awarenessResult = await this.awareness.reconcile()
    this.jobs.completeStep(awarenessStep, worker, awarenessResult)

    const second = this.jobs.claimReadyStep(worker, 60_000)
    if (second?.id !== commitmentStep) throw new Error('Commitment step was not ready')
    const imported = this.commitmentsPath
      ? await importMarkdownCommitments(this.db, this.commitmentsPath)
      : 0
    const extracted = extractCommitmentCandidates(this.db)
    this.jobs.completeStep(commitmentStep, worker, { imported, extracted })

    const third = this.jobs.claimReadyStep(worker, 60_000)
    if (third?.id !== briefStep) throw new Error('Brief step was not ready')
    const brief = buildExecutiveBrief(this.db)
    this.jobs.completeStep(briefStep, worker, { brief })

    this.jobs.transitionJob(jobId, 'verifying')
    const verification = verifyExecutiveBrief(this.db, brief, awarenessResult)
    this.jobs.recordEvidence({
      jobId,
      stepId: briefStep,
      verifier: 'executive-brief-verifier',
      source: 'adam.sqlite:project_ledger+sessions+commitments',
      result: { passed: verification.passed, verification, brief, selectedPlan: selected.id, algorithmReview: selected.algorithm }
    })
    if (!verification.passed) throw new Error(`Executive brief verification failed: ${verification.failures.join(', ')}`)
    this.jobs.transitionJob(jobId, 'completed')
    this.jobs.transitionJob(jobId, 'reported')
    return { commandId: command.id, jobId, brief, selectedPlan: selected.id }
  }

  private algorithmReview(requirement: string, owner: string, observableImpact: string, mechanism: string): CandidatePlan['algorithm'] {
    return {
      stepOrder: [1, 2, 3, 4, 5],
      ledger: [{ requirement, owner, verdict: 'KEEP', observableImpact }],
      deletions: [{ item: 'Any duplicate planning or execution path', savings: 'One canonical supervisor path' }],
      simplifications: [{ item: requirement, mechanism }],
      cycleTime: {
        loop: 'plan to verified evidence',
        currentSeconds: 30,
        proposedSeconds: 10,
        method: 'Use the existing live adapter and focused verifier.'
      },
      automations: [{
        candidate: 'Recurring plan execution',
        evidencedRepetitions: 0,
        successCondition: 'The selected definition of done passes with independent evidence.',
        ready: false
      }]
    }
  }
}
