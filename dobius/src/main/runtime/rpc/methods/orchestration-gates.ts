import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalFiniteNumber, OptionalString, requiredString } from '../schemas'
import type { GateStatus } from '../../orchestration/db'
import { Coordinator } from '../../orchestration/coordinator'
import { assertExecutionAdmitted } from '../../../agents/execution-gate'

// Why: the coordinator instance is stored at module scope so orchestration.runStop
// can signal it to halt. Only one coordinator can run at a time (enforced by
// the DB's active-run check), so a single reference suffices. activeRunId is
// the coordinator_runs row it owns; any other 'running' row is an orphan.
let activeCoordinator: Coordinator | null = null
let activeRunId: string | null = null
// Why: runStop clears activeCoordinator at once, but a stopped loop can still
// be mid-tick (awaiting a terminal). Until its promise settles a new run must
// not start, or both loops could dispatch the same ready task.
const unsettledLoops = new Map<Coordinator, string>()

const RunParams = z.object({
  spec: requiredString('Missing --spec'),
  from: OptionalString,
  pollIntervalMs: OptionalFiniteNumber,
  maxConcurrent: OptionalFiniteNumber,
  worktree: OptionalString
})

const RunStopParams = z.object({})

const GateCreateParams = z.object({
  task: requiredString('Missing --task'),
  question: requiredString('Missing --question'),
  options: OptionalString
})

const GateResolveParams = z.object({
  id: requiredString('Missing --id'),
  resolution: requiredString('Missing --resolution')
})

const GateListParams = z.object({
  task: OptionalString,
  status: z.enum(['pending', 'resolved', 'timeout']).optional()
})

export const ORCHESTRATION_GATE_METHODS: RpcMethod[] = [
  // Why: Section 4.12 — orchestration.run returns immediately with a run ID.
  // The coordinator loop runs in the background; progress is queried via
  // orchestration.taskList. This prevents the RPC call from blocking the
  // CLI (or any caller) for the entire duration of the pipeline.
  defineMethod({
    name: 'orchestration.run',
    params: RunParams,
    handler: (params, { runtime }) => {
      // Why: a coordinator run dispatches autonomous workers, so "Pause crew"
      // must refuse it before any coordinator row is written.
      assertExecutionAdmitted('agent-run')
      const db = runtime.getOrchestrationDb()

      for (const [loop, runId] of unsettledLoops) {
        if (loop !== activeCoordinator) {
          throw new Error(`Coordinator run ${runId} is still stopping; retry once it has exited`)
        }
      }

      const coordinatorHandle = params.from ?? 'coordinator'
      const coordinator = new Coordinator(db, runtime, {
        spec: params.spec,
        coordinatorHandle,
        pollIntervalMs: params.pollIntervalMs,
        maxConcurrent: params.maxConcurrent,
        worktree: params.worktree
      })

      // Why: a row left 'running' by a dead process (or a stopped run) has no
      // live owner and is retired; a live run, here or in another process
      // sharing the DB, still refuses the start.
      const run = db.startCoordinatorRun(
        {
          spec: params.spec,
          coordinatorHandle,
          pollIntervalMs: params.pollIntervalMs
        },
        activeCoordinator ? activeRunId : null
      )
      activeCoordinator = coordinator
      activeRunId = run.id
      unsettledLoops.set(coordinator, run.id)

      // Why: fire-and-forget — the coordinator loop runs in the event loop
      // background. Results are persisted to the DB; callers query via
      // orchestration.taskList or orchestration.runStatus.
      coordinator.runFromExistingRun(run.id).finally(() => {
        unsettledLoops.delete(coordinator)
        if (activeCoordinator === coordinator) {
          activeCoordinator = null
          activeRunId = null
        }
      })

      return { runId: run.id, status: 'running' }
    }
  }),

  defineMethod({
    name: 'orchestration.runStop',
    params: RunStopParams,
    handler: (_params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      // Why: stopping must work even when no in-memory coordinator owns the
      // 'running' row (e.g. after a restart); retire such rows durably.
      const orphaned = db.failOrphanedCoordinatorRuns(activeCoordinator ? activeRunId : null)
      const run = db.getActiveCoordinatorRun()
      if (!run) {
        if (orphaned.length > 0) {
          return { runId: orphaned[0], stopped: true }
        }
        throw new Error('No active coordinator run')
      }
      // Why: another live process owns this run; marking it failed here would
      // not stop that loop and would let a second coordinator start.
      if (!db.ownsCoordinatorRun(run)) {
        throw new Error(
          `Coordinator run ${run.id}${db.describeOwner(run)} must be stopped from that instance`
        )
      }

      if (activeCoordinator) {
        activeCoordinator.stop()
        activeCoordinator = null
        activeRunId = null
      }
      db.updateCoordinatorRun(run.id, 'failed')

      return { runId: run.id, stopped: true }
    }
  }),

  defineMethod({
    name: 'orchestration.gateCreate',
    params: GateCreateParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      let options: string[] | undefined
      if (params.options) {
        try {
          const parsed = JSON.parse(params.options)
          if (!Array.isArray(parsed) || !parsed.every((option) => typeof option === 'string')) {
            throw new Error('not an array of strings')
          }
          options = parsed
        } catch {
          throw new Error('Invalid --options: must be a JSON array of strings')
        }
      }
      const gate = db.createGate({
        taskId: params.task,
        question: params.question,
        options
      })
      return { gate }
    }
  }),

  defineMethod({
    name: 'orchestration.gateResolve',
    params: GateResolveParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const gate = db.resolveGate(params.id, params.resolution)
      if (!gate) {
        throw new Error(`Gate not found: ${params.id}`)
      }
      return { gate }
    }
  }),

  defineMethod({
    name: 'orchestration.gateList',
    params: GateListParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const gates = db.listGates({
        taskId: params.task,
        status: params.status as GateStatus
      })
      return { gates, count: gates.length }
    }
  })
]
