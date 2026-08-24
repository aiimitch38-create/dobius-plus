/**
 * Scenario fixtures for the six channelTemplate.* RPC methods
 * (channelTemplate.create/show/update/duplicate/list/delete — defined in
 * ./channel-templates.ts), for the communications command verification
 * harness's composable scenario registry
 * (src/main/communications/verify/command-scenario.ts's `SCENARIO_STEPS`
 * family contract — see that file's top doc comment). The harness owner
 * splices this in with one import + one array-spread in that file; this
 * module never edits verify/ itself.
 *
 * Types/helpers come from '../../../communications/scenario-contract', NOT
 * from verify/command-scenario — that path lives under the excluded verify/
 * project and trips TS6307 under config/tsconfig.node.json (see
 * scenario-contract.ts's own doc for why it exists at this unexcluded
 * location).
 *
 * SEAM: every step sets via: 'method'. These camelCase names are RPC method
 * names registered in ALL_RPC_METHODS and listed in
 * COMMUNICATIONS_RUNTIME_METHODS (src/shared/communications-bridge.ts), so
 * they are reachable ONLY through the real gateway pipeline (sender-trust +
 * allowlist + dispatcher) — the vendored Buzz client's Tauri-command switch
 * has no case for them (its cases use the snake_case aliases covered by
 * communications/canvas/canvas.scenarios.ts, which share this feature's
 * underlying store but are separate commands with separate fixtures).
 *
 * NO requiresSecondBoundary ANYWHERE: this family never touches the relay.
 * channel-template-store.ts persists to userData/channel-templates.json
 * ("purely local user preference data, not a relay concept" — see
 * channel-template-record.ts's doc); no NIP-33 addressable kind-39000-ish
 * event is published by any handler here, so the same-second supersede risk
 * the flag guards against cannot arise.
 *
 * CLEANUP LIMIT: run-verification.test.ts's method-seam invariant requires
 * every via:'method' step to carry a UNIQUE command name across the whole
 * composed SCENARIO, so channelTemplate.delete can appear only once and the
 * duplicate's "(Copy)" row cannot be removed by a second call (the sibling
 * vendor-seam family has the same one-delete budget). Nothing outlives the
 * run regardless: the harness mocks app.getPath('userData') to a fresh
 * mkdtemp scratch directory (verify/runtime-bridge-harness.ts), so deleting
 * the original — the primary subject of the create→show→update→duplicate
 * chain — keeps this family self-cleaning per run.
 */
import {
  fail,
  isRecord,
  ok,
  type ScenarioContext,
  type ScenarioStep,
  type ShapeOutcome
} from '../../../communications/scenario-contract'

function familyOf(ctx: ScenarioContext): Record<string, unknown> {
  return ctx.family
}

const CREATE_NAME = 'Verify Method Channel Template'
const CREATE_DESCRIPTION = 'created by the communications verification harness'
const UPDATE_NAME = 'Verify Method Channel Template Updated'
const UPDATE_DESCRIPTION = 'updated by the communications verification harness'
const CANVAS_TEMPLATE = '# Verify Starter Canvas'

// personaId/teamId are structurally sanitized by the store, never validated
// against agents-store/team-store (see channel-template-record.ts's doc), so
// literal fixture ids here exercise the real round-trip without depending on
// another family's captures.
const CREATE_AGENTS = {
  personas: [
    { personaId: 'verify-method-template-persona', runtime: 'claude-code', model: null, role: 'reviewer', backend: { type: 'local' } }
  ],
  teams: []
}
const UPDATE_AGENTS = {
  personas: [],
  teams: [
    { teamId: 'verify-method-template-team', runtime: null, model: null, backend: { type: 'provider', id: 'verify-provider' } }
  ]
}

/** Key-order-independent deep equality over plain JSON values; array order
 * is significant (the store preserves append order deterministically). */
function jsonEquals(actual: unknown, expected: unknown): boolean {
  if (actual === expected) {
    return true
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && actual.every((value, index) => jsonEquals(value, expected[index]))
  }
  if (isRecord(actual) && isRecord(expected)) {
    const actualKeys = Object.keys(actual)
    return (
      actualKeys.length === Object.keys(expected).length &&
      Object.keys(expected).every((key) => key in actual && jsonEquals(actual[key], expected[key]))
    )
  }
  return false
}

/** Full ChannelTemplate record shape (channel-template-record.ts) — the
 * camelCase shape the RPC handlers return, unlike the vendor seam's
 * snake_case projection asserted by canvas.scenarios.ts. */
function isRawChannelTemplateShape(value: unknown): ShapeOutcome {
  if (!isRecord(value)) {
    return fail(`expected a channel template object, got ${typeof value}`)
  }
  if (typeof value.id !== 'string' || !value.id) {
    return fail('missing id')
  }
  if (typeof value.name !== 'string' || !value.name) {
    return fail('missing name')
  }
  if (value.description !== null && typeof value.description !== 'string') {
    return fail(`description should be string|null, got ${JSON.stringify(value.description)}`)
  }
  if (typeof value.channelType !== 'string' || !value.channelType) {
    return fail(`channelType should be a non-empty string, got ${JSON.stringify(value.channelType)}`)
  }
  if (typeof value.visibility !== 'string' || !value.visibility) {
    return fail(`visibility should be a non-empty string, got ${JSON.stringify(value.visibility)}`)
  }
  if (value.canvasTemplate !== null && typeof value.canvasTemplate !== 'string') {
    return fail(`canvasTemplate should be string|null, got ${JSON.stringify(value.canvasTemplate)}`)
  }
  if (!isRecord(value.agents) || !Array.isArray(value.agents.personas) || !Array.isArray(value.agents.teams)) {
    return fail(`agents should be { personas: [], teams: [] }, got ${JSON.stringify(value.agents)}`)
  }
  if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') {
    return fail(`createdAt/updatedAt should be numbers, got ${JSON.stringify([value.createdAt, value.updatedAt])}`)
  }
  return ok()
}

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    command: 'channelTemplate.create',
    via: 'method',
    // Non-default channelType/visibility on purpose: normalizeChannelType/
    // normalizeVisibility silently fall back to 'stream'/'open' on unknown
    // input, so asserting 'forum'/'private' proves the values round-tripped
    // instead of riding the fallback.
    args: () => ({
      name: CREATE_NAME,
      description: CREATE_DESCRIPTION,
      channelType: 'forum',
      visibility: 'private',
      canvasTemplate: CANVAS_TEMPLATE,
      agents: CREATE_AGENTS
    }),
    shapeCheck: (result) => {
      if (!isRecord(result) || !isRecord(result.template)) {
        return fail(`expected { template }, got ${JSON.stringify(result)}`)
      }
      const template = result.template
      const shape = isRawChannelTemplateShape(template)
      if (!shape.ok) {
        return shape
      }
      if (template.name !== CREATE_NAME) {
        return fail(`name not set: ${JSON.stringify(template.name)}`)
      }
      if (template.description !== CREATE_DESCRIPTION) {
        return fail(`description did not round-trip: ${JSON.stringify(template.description)}`)
      }
      if (template.channelType !== 'forum' || template.visibility !== 'private') {
        return fail(`classification did not round-trip: ${JSON.stringify([template.channelType, template.visibility])}`)
      }
      if (template.canvasTemplate !== CANVAS_TEMPLATE) {
        return fail(`canvasTemplate did not round-trip: ${JSON.stringify(template.canvasTemplate)}`)
      }
      if (!jsonEquals(template.agents, CREATE_AGENTS)) {
        return fail(`agents did not round-trip: ${JSON.stringify(template.agents)}`)
      }
      if (template.createdAt !== template.updatedAt) {
        return fail(`a fresh row should have createdAt === updatedAt, got ${JSON.stringify([template.createdAt, template.updatedAt])}`)
      }
      return ok()
    },
    capture: (result, ctx) => {
      if (isRecord(result) && isRecord(result.template) && typeof result.template.id === 'string') {
        familyOf(ctx).methodChannelTemplateId = result.template.id
      }
    }
  },
  {
    command: 'channelTemplate.show',
    via: 'method',
    // Reads back through getChannelTemplate, so matching the created row
    // proves a real store read by id, not an echo of the request.
    args: (ctx) => ({ id: familyOf(ctx).methodChannelTemplateId }),
    shapeCheck: (result, ctx) => {
      if (!isRecord(result) || !isRecord(result.template)) {
        return fail(`expected { template }, got ${JSON.stringify(result)}`)
      }
      const template = result.template
      const shape = isRawChannelTemplateShape(template)
      if (!shape.ok) {
        return shape
      }
      if (template.id !== familyOf(ctx).methodChannelTemplateId) {
        return fail(`show returned a different template id: ${JSON.stringify(template.id)}`)
      }
      if (template.name !== CREATE_NAME || template.visibility !== 'private') {
        return fail(`showed a stale row: ${JSON.stringify([template.name, template.visibility])}`)
      }
      if (template.createdAt !== template.updatedAt) {
        return fail(`row was mutated between create and show: ${JSON.stringify([template.createdAt, template.updatedAt])}`)
      }
      return ok()
    }
  },
  {
    command: 'channelTemplate.update',
    via: 'method',
    // Flips visibility back to 'open' and swaps the agents roster, so the
    // later duplicate/list steps prove mutations propagate to copies and
    // the roster read-back rather than only living on the returned row.
    args: (ctx) => ({
      id: familyOf(ctx).methodChannelTemplateId,
      updates: { name: UPDATE_NAME, description: UPDATE_DESCRIPTION, visibility: 'open', agents: UPDATE_AGENTS }
    }),
    shapeCheck: (result, ctx) => {
      if (!isRecord(result) || !isRecord(result.template)) {
        return fail(`expected { template }, got ${JSON.stringify(result)}`)
      }
      const template = result.template
      const shape = isRawChannelTemplateShape(template)
      if (!shape.ok) {
        return shape
      }
      if (template.id !== familyOf(ctx).methodChannelTemplateId) {
        return fail(`update returned a different template id: ${JSON.stringify(template.id)}`)
      }
      if (template.name !== UPDATE_NAME || template.description !== UPDATE_DESCRIPTION) {
        return fail(`name/description change did not take: ${JSON.stringify([template.name, template.description])}`)
      }
      if (template.visibility !== 'open') {
        return fail(`visibility change did not take: ${JSON.stringify(template.visibility)}`)
      }
      if (template.channelType !== 'forum') {
        return fail(`unspecified channelType should stay 'forum': ${JSON.stringify(template.channelType)}`)
      }
      if (!jsonEquals(template.agents, UPDATE_AGENTS)) {
        return fail(`agents replacement did not take: ${JSON.stringify(template.agents)}`)
      }
      const { createdAt, updatedAt } = template
      if (typeof updatedAt !== 'number' || typeof createdAt !== 'number' || updatedAt < createdAt) {
        return fail(`updatedAt should not regress below createdAt: ${JSON.stringify([createdAt, updatedAt])}`)
      }
      return ok()
    }
  },
  {
    command: 'channelTemplate.duplicate',
    via: 'method',
    args: (ctx) => ({ id: familyOf(ctx).methodChannelTemplateId }),
    shapeCheck: (result, ctx) => {
      if (!isRecord(result) || !isRecord(result.template)) {
        return fail(`expected { template }, got ${JSON.stringify(result)}`)
      }
      const template = result.template
      const shape = isRawChannelTemplateShape(template)
      if (!shape.ok) {
        return shape
      }
      if (template.id === familyOf(ctx).methodChannelTemplateId) {
        return fail('duplicate returned the same id as the original')
      }
      if (template.name !== `${UPDATE_NAME} (Copy)`) {
        return fail(`unexpected duplicate name: ${JSON.stringify(template.name)}`)
      }
      if (template.visibility !== 'open' || !jsonEquals(template.agents, UPDATE_AGENTS)) {
        return fail(`copy diverged from the updated source: ${JSON.stringify([template.visibility, template.agents])}`)
      }
      if (template.createdAt !== template.updatedAt) {
        return fail(`a fresh copy should have createdAt === updatedAt, got ${JSON.stringify([template.createdAt, template.updatedAt])}`)
      }
      return ok()
    },
    capture: (result, ctx) => {
      if (isRecord(result) && isRecord(result.template) && typeof result.template.id === 'string') {
        familyOf(ctx).methodChannelTemplateCopyId = result.template.id
      }
    }
  },
  {
    command: 'channelTemplate.list',
    via: 'method',
    // Membership assertions only — other families legitimately share the
    // roster within a run, so neither an exact length nor an exact roster
    // would be deterministic. Finding BOTH rows post-update proves list
    // reflects the store, including the mutation and the copy.
    args: () => ({}),
    shapeCheck: (result, ctx) => {
      if (!isRecord(result) || !Array.isArray(result.templates)) {
        return fail(`expected { templates: [] }, got ${JSON.stringify(result)}`)
      }
      // Local binding: TS narrowing of `result.templates` does not carry
      // into the closure below.
      const roster: unknown[] = result.templates
      const find = (id: unknown) => roster.find((entry) => isRecord(entry) && entry.id === id)
      const original = find(familyOf(ctx).methodChannelTemplateId)
      if (!isRecord(original)) {
        return fail(`created template missing from list: ${JSON.stringify(roster.map((t) => (isRecord(t) ? t.id : t)))}`)
      }
      if (original.name !== UPDATE_NAME || original.visibility !== 'open') {
        return fail(`list shows a stale original: ${JSON.stringify([original.name, original.visibility])}`)
      }
      const copy = find(familyOf(ctx).methodChannelTemplateCopyId)
      if (!isRecord(copy)) {
        return fail('duplicated copy missing from list')
      }
      if (copy.name !== `${UPDATE_NAME} (Copy)`) {
        return fail(`list shows a stale copy: ${JSON.stringify(copy.name)}`)
      }
      return ok()
    }
  },
  {
    command: 'channelTemplate.delete',
    via: 'method',
    // Deletes the ORIGINAL (captured at create). The "(Copy)" row survives —
    // see this file's CLEANUP LIMIT note. removeChannelTemplate filters by
    // id without an existence check, but the handler runs
    // showChannelTemplate(params.id) first, so a throw here means the
    // earlier chain broke, not merely a double delete.
    args: (ctx) => ({ id: familyOf(ctx).methodChannelTemplateId }),
    shapeCheck: (result, ctx) =>
      isRecord(result) && result.removed === true && result.id === familyOf(ctx).methodChannelTemplateId
        ? ok()
        : fail(`unexpected delete result: ${JSON.stringify(result)}`)
  }
]
