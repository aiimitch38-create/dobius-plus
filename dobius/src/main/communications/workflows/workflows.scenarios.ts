/**
 * Verification-harness fixtures for the workflow.* RPC family
 * (workflow-rpc-methods.ts). Composed into the shared SCENARIO array by
 * ../verify/command-scenario.ts (the harness owner splices this in with one
 * import + one array-spread); this module never edits verify/ itself.
 *
 * SEAM — every step here sets via: 'method' and dispatches by RPC METHOD
 * name ('workflow.create', ...). The vendored Buzz client reaches these same
 * features through snake_case Tauri commands (create_workflow,
 * get_channel_workflows, ... in vendor/buzz-desktop/src/shared/api/
 * tauriWorkflows.ts), so the camelCase workflow.* names have no case in the
 * vendor switch at all — the gateway seam (sender-trust + allowlist +
 * dispatcher) is the only real path they can be exercised over. All eight
 * names are already in COMMUNICATIONS_RUNTIME_METHODS (src/shared/
 * communications-bridge.ts), so a missing-allowlist regression surfaces as a
 * loud ERROR, not a silent skip.
 *
 * NO requiresSecondBoundary anywhere: create/update persist to the local
 * userData JSON store only (workflows.json via workflow-store.ts) and never
 * publish relay events of any kind, so there is no addressable-event
 * created_at tie-break race for the runner's second-boundary wait to guard.
 *
 * TRIGGER DETERMINISM: triggerWorkflow executes steps in-process with a
 * deliberately small supported vocabulary (log/delay/noop — see
 * workflow-executor.ts) and never spawns a real agent run, so a definition
 * containing only those step types deterministically completes headless.
 * This fixture uses exactly such a definition; no managed agent or runnable
 * target is needed.
 *
 * CLEANUP: the final step deletes the workflow it created. deleteWorkflow
 * also removes that workflow's run history (removeRunsForWorkflow in
 * workflow-service.ts), so nothing this file minted outlives its last step.
 */
import { fail, hasStringField, isRecord, ok, type ScenarioStep } from '../scenario-contract'

const WORKFLOW_ID_KEY = 'workflowsVerifyWorkflowId'
const RUN_ID_KEY = 'workflowsVerifyRunId'

const CREATE_NAME = 'Workflows Verify Probe'
const UPDATED_NAME = 'Workflows Verify Probe (updated)'

// Only executor-supported step types (log/noop), so workflow.trigger's
// verdict reflects the real execution path rather than honest-skip behavior.
const CREATE_YAML = [
  'name: Workflows Verify Probe',
  'steps:',
  '  - id: greet',
  '    type: log',
  '    with:',
  '      message: workflows verification probe'
].join('\n')

const UPDATE_YAML = [
  'name: Workflows Verify Probe (updated)',
  'steps:',
  '  - id: greet',
  '    type: log',
  '    with:',
  '      message: workflows verification probe',
  '  - id: settle',
  '    type: noop'
].join('\n')

function capturedWorkflowId(ctx: { family: Record<string, unknown> }): unknown {
  return ctx.family[WORKFLOW_ID_KEY]
}

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    // Asserts the full Workflow record the store actually returns (see
    // WorkflowCreateInput -> createWorkflow in workflow-store.ts), not just
    // "returned something": parsed name/steps from the YAML, channel scoping,
    // owner, generated webhook secret, active default status, timestamps.
    command: 'workflow.create',
    via: 'method',
    args: (ctx) => ({
      ownerPubkey: ctx.selfPubkey,
      channelId: ctx.channelId,
      yamlDefinition: CREATE_YAML
    }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !isRecord(r.workflow)) {
        return fail(`expected { workflow }, got ${JSON.stringify(r)}`)
      }
      const wf = r.workflow
      if (!hasStringField(wf, 'id')) {
        return fail('missing workflow.id')
      }
      if (wf.name !== CREATE_NAME) {
        return fail(`expected YAML-derived name ${JSON.stringify(CREATE_NAME)}, got ${JSON.stringify(wf.name)}`)
      }
      if (wf.ownerPubkey !== ctx.selfPubkey) {
        return fail(`owner mismatch: ${JSON.stringify(wf.ownerPubkey)}`)
      }
      if (wf.channelId !== ctx.channelId) {
        return fail(`channelId mismatch: expected ${JSON.stringify(ctx.channelId)}, got ${JSON.stringify(wf.channelId)}`)
      }
      if (wf.definitionYaml !== CREATE_YAML) {
        return fail('definitionYaml did not round-trip verbatim')
      }
      if (!isRecord(wf.definition)) {
        return fail('missing parsed definition object')
      }
      if (!Array.isArray(wf.steps) || wf.steps.length !== 1) {
        return fail(`expected one parsed step, got ${JSON.stringify(wf.steps)}`)
      }
      const [step] = wf.steps
      if (!isRecord(step) || step.id !== 'greet' || step.type !== 'log' || !isRecord(step.with)) {
        return fail(`unexpected parsed step shape: ${JSON.stringify(step)}`)
      }
      if (wf.status !== 'active') {
        return fail(`expected default status 'active', got ${JSON.stringify(wf.status)}`)
      }
      if (!hasStringField(wf, 'webhookSecret')) {
        return fail('missing generated webhookSecret')
      }
      return typeof wf.createdAt === 'number' && typeof wf.updatedAt === 'number'
        ? ok()
        : fail('missing numeric createdAt/updatedAt')
    },
    capture: (r, ctx) => {
      if (isRecord(r) && isRecord(r.workflow) && typeof r.workflow.id === 'string') {
        ctx.family[WORKFLOW_ID_KEY] = r.workflow.id
      }
    }
  },
  {
    command: 'workflow.show',
    via: 'method',
    args: (ctx) => ({ workflowId: capturedWorkflowId(ctx) }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !isRecord(r.workflow)) {
        return fail(`expected { workflow }, got ${JSON.stringify(r)}`)
      }
      const wf = r.workflow
      return wf.id === ctx.family[WORKFLOW_ID_KEY] && wf.name === CREATE_NAME && wf.channelId === ctx.channelId
        ? ok()
        : fail(`showed a different workflow than the one created: ${JSON.stringify({ id: wf.id, name: wf.name })}`)
    }
  },
  {
    // Renames + adds a second step via new YAML; the store keeps id,
    // channelId, and owner stable across updates and bumps updatedAt only.
    command: 'workflow.update',
    via: 'method',
    args: (ctx) => ({ workflowId: capturedWorkflowId(ctx), yamlDefinition: UPDATE_YAML }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !isRecord(r.workflow)) {
        return fail(`expected { workflow }, got ${JSON.stringify(r)}`)
      }
      const wf = r.workflow
      if (wf.id !== ctx.family[WORKFLOW_ID_KEY]) {
        return fail('update changed the workflow id')
      }
      if (wf.name !== UPDATED_NAME) {
        return fail(`expected updated name, got ${JSON.stringify(wf.name)}`)
      }
      if (wf.definitionYaml !== UPDATE_YAML) {
        return fail('updated definitionYaml did not round-trip verbatim')
      }
      if (!Array.isArray(wf.steps) || wf.steps.length !== 2) {
        return fail(`expected two parsed steps after update, got ${JSON.stringify(wf.steps)}`)
      }
      if (
        !isRecord(wf.steps[0]) || wf.steps[0].id !== 'greet' ||
        !isRecord(wf.steps[1]) || wf.steps[1].id !== 'settle'
      ) {
        return fail(`unexpected step ids after update: ${JSON.stringify(wf.steps)}`)
      }
      return typeof wf.createdAt === 'number' && typeof wf.updatedAt === 'number' && wf.updatedAt >= wf.createdAt
        ? ok()
        : fail(`updatedAt not bumped past createdAt: ${JSON.stringify({ createdAt: wf.createdAt, updatedAt: wf.updatedAt })}`)
    }
  },
  {
    command: 'workflow.listByChannel',
    via: 'method',
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !Array.isArray(r.workflows)) {
        return fail(`expected { workflows: [...] }, got ${JSON.stringify(r)}`)
      }
      const ours = r.workflows.find((entry) => isRecord(entry) && entry.id === ctx.family[WORKFLOW_ID_KEY])
      if (!isRecord(ours)) {
        return fail('created workflow missing from its own channel listing')
      }
      if (ours.name !== UPDATED_NAME) {
        return fail(`listing served a stale name: ${JSON.stringify(ours.name)}`)
      }
      const foreign = r.workflows.filter((entry) => isRecord(entry) && entry.channelId !== ctx.channelId)
      return foreign.length === 0
        ? ok()
        : fail(`listing leaked workflows from other channels: ${JSON.stringify(foreign.map((w) => (isRecord(w) ? w.id : w)))}`)
    }
  },
  {
    // The unrelated second id proves multi-channel filtering still matches
    // our channel rather than merely echoing everything back.
    command: 'workflow.listByChannels',
    via: 'method',
    args: (ctx) => ({ channelIds: [ctx.channelId, 'workflows-verify-unrelated-channel'] }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !Array.isArray(r.workflows)) {
        return fail(`expected { workflows: [...] }, got ${JSON.stringify(r)}`)
      }
      if (!r.workflows.some((entry) => isRecord(entry) && entry.id === ctx.family[WORKFLOW_ID_KEY])) {
        return fail('created workflow missing from multi-channel listing')
      }
      // ctx.channelId is CORE-guaranteed by this point; the fallback only
      // satisfies the Set<string> type if a broken upstream ever left it unset.
      const requested = new Set<string>([ctx.channelId ?? '', 'workflows-verify-unrelated-channel'])
      const outside = r.workflows.filter(
        (entry) => isRecord(entry) && (typeof entry.channelId !== 'string' || !requested.has(entry.channelId))
      )
      return outside.length === 0
        ? ok()
        : fail(`multi-channel listing returned rows outside the requested set: ${JSON.stringify(outside.map((w) => (isRecord(w) ? w.id : w)))}`)
    }
  },
  {
    // Both fixture steps are executor-supported types, so the run must land
    // 'completed' — an honest skipped-step trace would show up as a FAIL
    // here. No agent/runnable target is involved (see module doc).
    command: 'workflow.trigger',
    via: 'method',
    args: (ctx) => ({ workflowId: capturedWorkflowId(ctx) }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && hasStringField(r, 'runId') && r.workflowId === ctx.family[WORKFLOW_ID_KEY] && r.status === 'completed'
        ? ok()
        : fail(`unexpected trigger result: ${JSON.stringify(r)}`),
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.runId === 'string') {
        ctx.family[RUN_ID_KEY] = r.runId
      }
    }
  },
  {
    // Runs come back newest-first (workflow-run-store.ts listRuns); the
    // single run this scenario triggered must therefore sit first, carrying
    // the real per-step trace for greet/settle.
    command: 'workflow.runs',
    via: 'method',
    args: (ctx) => ({ workflowId: capturedWorkflowId(ctx), limit: 10 }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !Array.isArray(r.runs)) {
        return fail(`expected { runs: [...] }, got ${JSON.stringify(r)}`)
      }
      if (r.runs.length < 1) {
        return fail('triggered workflow has no recorded runs')
      }
      const [first] = r.runs
      if (!isRecord(first)) {
        return fail(`first run row was not an object: ${JSON.stringify(first)}`)
      }
      if (first.id !== ctx.family[RUN_ID_KEY]) {
        return fail(`newest-first ordering violated: top run ${JSON.stringify(first.id)} != triggered ${JSON.stringify(ctx.family[RUN_ID_KEY])}`)
      }
      if (first.status !== 'completed') {
        return fail(`run status ${JSON.stringify(first.status)}, expected completed`)
      }
      if (first.errorMessage !== null) {
        return fail(`completed run carried an error message: ${JSON.stringify(first.errorMessage)}`)
      }
      if (!Array.isArray(first.executionTrace)) {
        return fail('run missing executionTrace array')
      }
      const traced = first.executionTrace.map(
        (entry) => (isRecord(entry) && entry.status === 'completed' && typeof entry.stepId === 'string' ? entry.stepId : null)
      )
      return traced.join(',') === 'greet,settle'
        ? ok()
        : fail(`trace did not complete both steps in order: ${JSON.stringify(traced)}`)
    }
  },
  {
    // Cleanup: removes the workflow AND its run history
    // (removeRunsForWorkflow), leaving nothing behind for a later run.
    command: 'workflow.delete',
    via: 'method',
    args: (ctx) => ({ workflowId: capturedWorkflowId(ctx) }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && r.removed === true && r.workflowId === ctx.family[WORKFLOW_ID_KEY]
        ? ok()
        : fail(`unexpected delete result: ${JSON.stringify(r)}`)
  }
]
