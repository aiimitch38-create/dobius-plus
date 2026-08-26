/**
 * Scenario fixtures for the team.* RPC family (team.create/team.update/
 * team.delete — src/main/runtime/rpc/methods/teams.ts), for the
 * communications command verification harness's composable scenario
 * registry (src/main/communications/verify/command-scenario.ts's
 * SCENARIO_STEPS family contract — see that file's top doc comment). The
 * harness owner splices this in with one import + one array-spread in that
 * file; this module never edits verify/ itself.
 *
 * SEAM — every step sets via: 'method' and dispatches by RPC METHOD name.
 * The vendored Buzz client reached these features through snake_case Tauri
 * commands (create_team/update_team/delete_team in tauriTeams.ts), whose
 * switch wrapped the same operations as { input: {...} } and projected the
 * result to a snake_case RawTeam. The real handlers take flat params
 * (create) or { id, updates } (update), return { team } wrapping the
 * camelCase Team store record, and team.delete returns { removed, id }
 * rather than undefined — so this file's fixtures assert THAT wire shape,
 * not the retired projection.
 *
 * Types and pure helpers come from './scenario-contract' (NOT
 * '../verify/command-scenario' — that path lives under the excluded verify/
 * project and trips TS6307 on a real import; see scenario-contract.ts's own
 * doc for why it exists at this unexcluded location instead).
 */
import { fail, isRecord, ok, type ScenarioStep, type ShapeOutcome } from './scenario-contract'

function isStringArrayEqual(actual: unknown, expected: string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

/**
 * Full Team record shape check (team-store.ts's exported Team type — the
 * exact object the team.* handlers read/write through teams.json), including
 * the accountIds slot the retired vendor projection never surfaced. A
 * shapeCheck that only confirms "it's an object" is exactly how a stubbed
 * response would pass unnoticed.
 */
function isTeamRecordShape(team: unknown): ShapeOutcome {
  if (!isRecord(team)) {
    return fail(`expected a team record, got ${typeof team}`)
  }
  if (typeof team.id !== 'string' || !team.id) {
    return fail('missing id')
  }
  if (typeof team.name !== 'string' || !team.name) {
    return fail('missing name')
  }
  if (team.description !== null && typeof team.description !== 'string') {
    return fail(`description should be string|null, got ${JSON.stringify(team.description)}`)
  }
  if (team.instructions !== null && typeof team.instructions !== 'string') {
    return fail(`instructions should be string|null, got ${JSON.stringify(team.instructions)}`)
  }
  if (!Array.isArray(team.personaIds) || team.personaIds.some((id) => typeof id !== 'string')) {
    return fail(`personaIds should be string[], got ${JSON.stringify(team.personaIds)}`)
  }
  if (!Array.isArray(team.accountIds) || team.accountIds.some((id) => typeof id !== 'string')) {
    return fail(`accountIds should be string[], got ${JSON.stringify(team.accountIds)}`)
  }
  if (typeof team.createdAt !== 'number') {
    return fail(`createdAt should be a number, got ${JSON.stringify(team.createdAt)}`)
  }
  if (typeof team.updatedAt !== 'number') {
    return fail(`updatedAt should be a number, got ${JSON.stringify(team.updatedAt)}`)
  }
  return ok()
}

/** Unwraps { team }, returning the record or a failed ShapeOutcome. */
function unwrapTeamResult(result: unknown): { team: Record<string, unknown> } | ShapeOutcome {
  if (!isRecord(result) || !isRecord(result.team)) {
    return fail(`expected { team }, got ${JSON.stringify(result)}`)
  }
  return { team: result.team }
}

const CREATE_PERSONA_IDS = ['verify-team-agent-1', 'verify-team-agent-2']
const UPDATE_PERSONA_IDS = ['verify-team-agent-3']

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    // Flat params here: team.create's zod schema takes the fields at top
    // level — the { input: {...} } wrapper was the vendor switch's own
    // reshape, not part of the real contract.
    command: 'team.create',
    via: 'method',
    args: () => ({
      name: 'Verify Team',
      description: 'verification department',
      instructions: 'Be helpful',
      personaIds: CREATE_PERSONA_IDS
    }),
    shapeCheck: (result) => {
      const unwrapped = unwrapTeamResult(result)
      if ('ok' in unwrapped) {
        return unwrapped
      }
      const team = unwrapped.team
      const shape = isTeamRecordShape(team)
      if (!shape.ok) {
        return shape
      }
      if (team.name !== 'Verify Team') {
        return fail(`name not set: ${JSON.stringify(team.name)}`)
      }
      if (team.description !== 'verification department') {
        return fail(`description did not round-trip: ${JSON.stringify(team.description)}`)
      }
      if (team.instructions !== 'Be helpful') {
        return fail(`instructions did not round-trip: ${JSON.stringify(team.instructions)}`)
      }
      if (!isStringArrayEqual(team.personaIds, CREATE_PERSONA_IDS)) {
        return fail(`personaIds did not round-trip: ${JSON.stringify(team.personaIds)}`)
      }
      // No accountIds were sent, so the store must persist the honest empty
      // default rather than fabricated account bindings.
      if (Array.isArray(team.accountIds) && team.accountIds.length !== 0) {
        return fail(`accountIds should default to [], got ${JSON.stringify(team.accountIds)}`)
      }
      return ok()
    },
    capture: (result, ctx) => {
      if (
        isRecord(result) &&
        isRecord(result.team) &&
        typeof result.team.id === 'string'
      ) {
        ctx.teamId = result.team.id
      }
    }
  },
  // Why no 'team.list' step here: the core scenario steps already cover
  // roster reads before any family's steps run (see command-scenario.ts's
  // ORDERING comment), so a second listing here positioned after create
  // would prove nothing about persistence ordering — and run-verification's
  // method-seam invariant requires each dispatched method to appear exactly
  // once across SCENARIO. Persistence and round-tripping are instead
  // verified directly off each command's own returned record below — full
  // Team shape plus exact field values, which the RPC only returns by
  // reading back through the real store, not an echo of the input.
  {
    // Reshape note: team.update takes { id, updates } — the vendor switch
    // built that same pair by unpacking its { input: { id, ...fields } }
    // wrapper; here we send the handler's actual schema shape directly.
    command: 'team.update',
    via: 'method',
    args: (ctx) => ({
      id: ctx.teamId,
      updates: {
        name: 'Verify Team Updated',
        description: 'updated department',
        instructions: 'Be kind',
        personaIds: UPDATE_PERSONA_IDS
      }
    }),
    shapeCheck: (result, ctx) => {
      const unwrapped = unwrapTeamResult(result)
      if ('ok' in unwrapped) {
        return unwrapped
      }
      const team = unwrapped.team
      const shape = isTeamRecordShape(team)
      if (!shape.ok) {
        return shape
      }
      if (team.id !== ctx.teamId) {
        return fail('update returned a different team id')
      }
      if (team.name !== 'Verify Team Updated') {
        return fail(`name change did not take: ${JSON.stringify(team.name)}`)
      }
      if (team.description !== 'updated department') {
        return fail(`description change did not take: ${JSON.stringify(team.description)}`)
      }
      if (team.instructions !== 'Be kind') {
        return fail(`instructions change did not take: ${JSON.stringify(team.instructions)}`)
      }
      if (!isStringArrayEqual(team.personaIds, UPDATE_PERSONA_IDS)) {
        return fail(`personaIds change did not take: ${JSON.stringify(team.personaIds)}`)
      }
      return ok()
    }
  },
  {
    // Unlike the retired vendor seam (which resolved delete_team to bare
    // undefined), the handler confirms what it removed.
    command: 'team.delete',
    via: 'method',
    args: (ctx) => ({ id: ctx.teamId }),
    shapeCheck: (result, ctx) =>
      isRecord(result) && result.removed === true && result.id === ctx.teamId
        ? ok()
        : fail(`unexpected delete result: ${JSON.stringify(result)}`)
  }
]
