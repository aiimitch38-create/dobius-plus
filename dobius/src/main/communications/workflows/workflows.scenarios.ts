/**
 * Scenario fixtures for the workflow.* commands (create_workflow/
 * update_workflow/delete_workflow/get_workflow/get_channel_workflows/
 * get_channels_workflows/trigger_workflow/get_workflow_runs) for the
 * communications command verification harness's composable scenario
 * registry (src/main/communications/verify/command-scenario.ts's
 * `SCENARIO_STEPS` family contract). The harness owner splices this in with
 * one import + one array-spread in that file; this module never edits
 * verify/ itself.
 *
 * Local structural copies of ShapeOutcome/ScenarioContext/ScenarioStep
 * instead of importing them: verify/ has its own tsconfig
 * (composite:true, excluded from config/tsconfig.node.json — see
 * teams.scenarios.ts's identical doc comment) so a real cross-project
 * import fails with TS6307. TypeScript's structural typing still makes this
 * assignable to the real `ScenarioStep[]` wherever the harness owner
 * imports it.
 *
 * Deliberately does NOT cover trigger_workflow with a step that would spawn
 * a real agent — it doesn't need to: workflow-executor.ts's step
 * vocabulary (log/delay/noop) never contacts a live model account (see that
 * file's own doc comment), so exercising trigger_workflow here is safe.
 * Not covered: get_run_approvals/grant_approval/deny_approval — those
 * commands are out of this feature's 17-command scope (still
 * removed-pending/pending under a different owner per the manifest).
 */

type ShapeOutcome = { ok: true } | { ok: false; reason: string }

type WorkflowScenarioContext = {
  channelId?: string
  family: Record<string, unknown>
}

type WorkflowScenarioStep = {
  command: string
  args: (ctx: WorkflowScenarioContext) => unknown
  shapeCheck: (result: unknown, ctx: WorkflowScenarioContext) => ShapeOutcome
  capture?: (result: unknown, ctx: WorkflowScenarioContext) => void
  requiresSecondBoundary?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ok(): ShapeOutcome {
  return { ok: true }
}

function fail(reason: string): ShapeOutcome {
  return { ok: false, reason }
}

/**
 * Full RawWorkflow shape check (tauriWorkflows.ts's RawWorkflow, lines
 * 14-22): id/name/owner_pubkey/channel_id/definition/status/created_at/
 * updated_at, all snake_case, created_at/updated_at as NUMBERS (unlike
 * RawTeam's ISO-string timestamps) — this is the exact shape the paste-ready
 * dobiusCommunications.ts `workflowFromRecord` mapping in the build report
 * must produce, not just "it's an object".
 */
function isRawWorkflowShape(value: unknown): ShapeOutcome {
  if (!isRecord(value)) {
    return fail(`expected a workflow object, got ${typeof value}`)
  }
  if (typeof value.id !== 'string' || !value.id) {
    return fail('missing id')
  }
  if (typeof value.name !== 'string' || !value.name) {
    return fail('missing name')
  }
  if (typeof value.owner_pubkey !== 'string' || !value.owner_pubkey) {
    return fail('missing owner_pubkey')
  }
  if (value.channel_id !== null && typeof value.channel_id !== 'string') {
    return fail(`channel_id should be string|null, got ${JSON.stringify(value.channel_id)}`)
  }
  if (!isRecord(value.definition)) {
    return fail(`definition should be an object, got ${JSON.stringify(value.definition)}`)
  }
  if (!['active', 'disabled', 'archived'].includes(value.status as string)) {
    return fail(`unexpected status: ${JSON.stringify(value.status)}`)
  }
  if (typeof value.created_at !== 'number') {
    return fail(`created_at should be a number, got ${JSON.stringify(value.created_at)}`)
  }
  if (typeof value.updated_at !== 'number') {
    return fail(`updated_at should be a number, got ${JSON.stringify(value.updated_at)}`)
  }
  return ok()
}

const WORKFLOW_YAML = 'name: Verify Workflow\nsteps:\n  - id: greet\n    type: log\n    with:\n      message: hi\n'
const WORKFLOW_YAML_UPDATED =
  'name: Verify Workflow Updated\nstatus: disabled\nsteps:\n  - id: greet\n    type: log\n    with:\n      message: bye\n'

export const SCENARIO_STEPS: WorkflowScenarioStep[] = [
  {
    command: 'create_workflow',
    args: (ctx) => ({ channelId: ctx.channelId, yamlDefinition: WORKFLOW_YAML }),
    shapeCheck: (result) => {
      const shape = isRawWorkflowShape(result)
      if (!shape.ok) {
        return shape
      }
      const record = result as Record<string, unknown>
      if (record.name !== 'Verify Workflow') {
        return fail(`name not set from YAML: ${JSON.stringify(record.name)}`)
      }
      if (record.status !== 'active') {
        return fail(`expected default status active, got ${JSON.stringify(record.status)}`)
      }
      // RawWorkflowSaveResponse (tauriWorkflows.ts) is RawWorkflow FLATTENED
      // with an optional webhook_secret field, not a nested { workflow,
      // webhookSecret } — that nesting only happens in fromRawWorkflowSave,
      // the frontend wrapper this harness bypasses. isRawWorkflowShape
      // matching directly against `result` is therefore correct here.
      return ok()
    },
    capture: (result, ctx) => {
      if (isRecord(result) && typeof result.id === 'string') {
        ctx.family.workflowId = result.id
      }
    }
  },
  {
    command: 'get_channel_workflows',
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: (result, ctx) => {
      if (!Array.isArray(result)) {
        return fail('expected an array')
      }
      const mine = result.find((w) => isRecord(w) && w.id === ctx.family.workflowId)
      return mine ? ok() : fail('created workflow did not appear in get_channel_workflows')
    }
  },
  {
    command: 'get_channels_workflows',
    args: (ctx) => ({ channelIds: [ctx.channelId] }),
    shapeCheck: (result, ctx) => {
      if (!Array.isArray(result)) {
        return fail('expected an array')
      }
      const mine = result.find((w) => isRecord(w) && w.id === ctx.family.workflowId)
      return mine ? ok() : fail('created workflow did not appear in get_channels_workflows')
    }
  },
  {
    command: 'get_workflow',
    args: (ctx) => ({ workflowId: ctx.family.workflowId }),
    shapeCheck: (result, ctx) => {
      const shape = isRawWorkflowShape(result)
      if (!shape.ok) {
        return shape
      }
      const record = result as Record<string, unknown>
      return record.id === ctx.family.workflowId ? ok() : fail('get_workflow returned a different workflow id')
    }
  },
  {
    command: 'update_workflow',
    args: (ctx) => ({ workflowId: ctx.family.workflowId, yamlDefinition: WORKFLOW_YAML_UPDATED }),
    shapeCheck: (result, ctx) => {
      const shape = isRawWorkflowShape(result)
      if (!shape.ok) {
        return shape
      }
      const record = result as Record<string, unknown>
      if (record.id !== ctx.family.workflowId) {
        return fail('update_workflow returned a different workflow id')
      }
      if (record.name !== 'Verify Workflow Updated') {
        return fail(`name change did not take: ${JSON.stringify(record.name)}`)
      }
      if (record.status !== 'disabled') {
        return fail(`status change did not take: ${JSON.stringify(record.status)}`)
      }
      return ok()
    }
  },
  {
    command: 'trigger_workflow',
    args: (ctx) => ({ workflowId: ctx.family.workflowId }),
    shapeCheck: (result, ctx) => {
      if (!isRecord(result)) {
        return fail('expected a TriggerWorkflowResponse object')
      }
      if (result.workflow_id !== ctx.family.workflowId) {
        return fail(`workflow_id mismatch: ${JSON.stringify(result.workflow_id)}`)
      }
      if (typeof result.run_id !== 'string' || !result.run_id) {
        return fail('missing run_id')
      }
      if (typeof result.status !== 'string') {
        return fail('missing status')
      }
      return ok()
    },
    capture: (result, ctx) => {
      if (isRecord(result) && typeof result.run_id === 'string') {
        ctx.family.workflowRunId = result.run_id
      }
    }
  },
  {
    command: 'get_workflow_runs',
    args: (ctx) => ({ workflowId: ctx.family.workflowId, limit: 10 }),
    shapeCheck: (result, ctx) => {
      if (!Array.isArray(result)) {
        return fail('expected an array')
      }
      const run = result.find((r) => isRecord(r) && r.id === ctx.family.workflowRunId)
      if (!run || !isRecord(run)) {
        return fail('triggered run did not appear in get_workflow_runs')
      }
      if (run.workflow_id !== ctx.family.workflowId) {
        return fail('run workflow_id mismatch')
      }
      if (!Array.isArray(run.execution_trace) || run.execution_trace.length === 0) {
        return fail('expected a non-empty execution_trace for the "log" step')
      }
      const firstStep = run.execution_trace[0]
      if (!isRecord(firstStep) || firstStep.step_id !== 'greet' || firstStep.status !== 'completed') {
        return fail(`unexpected first trace entry: ${JSON.stringify(firstStep)}`)
      }
      return ok()
    }
  },
  {
    command: 'delete_workflow',
    args: (ctx) => ({ workflowId: ctx.family.workflowId }),
    shapeCheck: (result) => (result === undefined ? ok() : fail(`expected undefined, got ${JSON.stringify(result)}`))
  }
]
