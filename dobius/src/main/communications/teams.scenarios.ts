/**
 * Scenario fixtures for the team.* commands (list_teams/create_team/
 * update_team/delete_team), for the communications command verification
 * harness's composable scenario registry
 * (src/main/communications/verify/command-scenario.ts's `SCENARIO_STEPS`
 * family contract — see that file's top doc comment). The harness owner
 * splices this in with one import + one array-spread in that file; this
 * module never edits verify/ itself.
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
 * Full RawTeam shape check (tauriTeams.ts lines 8-21), including the
 * Buzz-only fields Dobius has no concept of — asserting them as the honest
 * false/null defaults documented in dobiusCommunications.ts's
 * DobiusTeamProjection, never left unchecked. A shapeCheck that only
 * confirms "it's an array" is exactly how the old hardcoded `[]` stub passed
 * unnoticed.
 */
function isRawTeamShape(value: unknown): ShapeOutcome {
  if (!isRecord(value)) {
    return fail(`expected a team object, got ${typeof value}`)
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
  if (value.instructions !== null && typeof value.instructions !== 'string') {
    return fail(`instructions should be string|null, got ${JSON.stringify(value.instructions)}`)
  }
  if (!Array.isArray(value.persona_ids) || value.persona_ids.some((id) => typeof id !== 'string')) {
    return fail(`persona_ids should be string[], got ${JSON.stringify(value.persona_ids)}`)
  }
  if (value.is_builtin !== false) {
    return fail(`is_builtin should be the honest default false, got ${JSON.stringify(value.is_builtin)}`)
  }
  if (value.source_dir !== null) {
    return fail(`source_dir should be the honest default null, got ${JSON.stringify(value.source_dir)}`)
  }
  if (value.is_symlink !== false) {
    return fail(`is_symlink should be the honest default false, got ${JSON.stringify(value.is_symlink)}`)
  }
  if (value.symlink_target !== null) {
    return fail(`symlink_target should be the honest default null, got ${JSON.stringify(value.symlink_target)}`)
  }
  if (value.version !== null) {
    return fail(`version should be the honest default null, got ${JSON.stringify(value.version)}`)
  }
  if (typeof value.created_at !== 'string' || !value.created_at) {
    return fail('missing created_at')
  }
  if (typeof value.updated_at !== 'string' || !value.updated_at) {
    return fail('missing updated_at')
  }
  return ok()
}

const CREATE_PERSONA_IDS = ['verify-team-agent-1', 'verify-team-agent-2']
const UPDATE_PERSONA_IDS = ['verify-team-agent-3']

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    command: 'create_team',
    args: () => ({
      input: {
        name: 'Verify Team',
        description: 'verification department',
        instructions: 'Be helpful',
        personaIds: CREATE_PERSONA_IDS
      }
    }),
    shapeCheck: (result) => {
      const shape = isRawTeamShape(result)
      if (!shape.ok) {
        return shape
      }
      const record = result as Record<string, unknown>
      if (record.name !== 'Verify Team') {
        return fail(`name not set: ${JSON.stringify(record.name)}`)
      }
      if (!isStringArrayEqual(record.persona_ids, CREATE_PERSONA_IDS)) {
        return fail(`persona_ids did not round-trip: ${JSON.stringify(record.persona_ids)}`)
      }
      return ok()
    },
    capture: (result, ctx) => {
      if (isRecord(result) && typeof result.id === 'string') {
        ctx.teamId = result.id
      }
    }
  },
  // Why no 'list_teams' step here: CORE_SCENARIO_STEPS already declares one
  // (command-scenario.ts:192) and run-verification.test.ts's own invariant
  // test requires every command to appear in SCENARIO exactly once — a
  // second 'list_teams' entry would break that test the moment this array
  // gets spliced in. It also wouldn't prove anything useful positioned here:
  // core steps run before every family's steps (see command-scenario.ts's
  // ORDERING comment), so core's 'list_teams' always fires before this
  // family creates a team at all. Persistence and round-tripping are instead
  // verified directly off each command's own returned record below — full
  // RawTeam shape plus exact field values, which the RPC only returns by
  // reading back through the real store, not an echo of the input.
  {
    command: 'update_team',
    args: (ctx) => ({
      input: {
        id: ctx.teamId,
        name: 'Verify Team Updated',
        description: 'updated department',
        instructions: 'Be kind',
        personaIds: UPDATE_PERSONA_IDS
      }
    }),
    shapeCheck: (result, ctx) => {
      const shape = isRawTeamShape(result)
      if (!shape.ok) {
        return shape
      }
      const record = result as Record<string, unknown>
      if (record.id !== ctx.teamId) {
        return fail('update_team returned a different team id')
      }
      if (record.name !== 'Verify Team Updated') {
        return fail(`name change did not take: ${JSON.stringify(record.name)}`)
      }
      if (!isStringArrayEqual(record.persona_ids, UPDATE_PERSONA_IDS)) {
        return fail(`persona_ids change did not take: ${JSON.stringify(record.persona_ids)}`)
      }
      return ok()
    }
  },
  {
    command: 'delete_team',
    args: (ctx) => ({ id: ctx.teamId }),
    shapeCheck: (result) => (result === undefined ? ok() : fail(`expected undefined, got ${JSON.stringify(result)}`))
  }
]
