import { describe, expect, it } from 'vitest'
import type { ScenarioContext } from './scenario-contract'
import { SCENARIO_STEPS } from './teams.scenarios'

// Why: exercises the fixtures' own args/shapeCheck/capture logic against
// fabricated RawTeam-shaped results, standing in for what the real
// team.* RPC methods (behind the harness's real dispatch seam) would return.
// This does not replace the real harness run — see the report's
// HARNESS_EFFECT section for that — it guards the fixture logic itself, so a
// typo in isRawTeamShape can't silently start passing malformed shapes.
function makeCtx(overrides: Partial<ScenarioContext> = {}): ScenarioContext {
  return { selfPubkey: 'self', otherPubkey: 'other', family: {}, ...overrides }
}

function makeRawTeam(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'team-1',
    name: 'Verify Team',
    description: 'verification department',
    instructions: 'Be helpful',
    persona_ids: ['verify-team-agent-1', 'verify-team-agent-2'],
    is_builtin: false,
    source_dir: null,
    is_symlink: false,
    symlink_target: null,
    version: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('team scenario fixtures', () => {
  it('orders steps create -> update -> delete (no list_teams — already core-owned)', () => {
    expect(SCENARIO_STEPS.map((step) => step.command)).toEqual(['create_team', 'update_team', 'delete_team'])
  })

  it('create_team sends the tauriTeams.ts input wrapper and passes on a matching honest shape', () => {
    const [createStep] = SCENARIO_STEPS
    const args = createStep.args(makeCtx()) as { input: Record<string, unknown> }
    expect(args.input).toMatchObject({ name: 'Verify Team', personaIds: expect.any(Array) })

    const result = makeRawTeam()
    expect(createStep.shapeCheck(result, makeCtx())).toEqual({ ok: true })
    createStep.capture?.(result, makeCtx())
  })

  it('create_team rejects a fabricated is_builtin/source_dir instead of the honest default', () => {
    const [createStep] = SCENARIO_STEPS
    const badResult = makeRawTeam({ is_builtin: true })
    expect(createStep.shapeCheck(badResult, makeCtx())).toMatchObject({ ok: false })

    const badSourceDir = makeRawTeam({ source_dir: '/some/fabricated/path' })
    expect(createStep.shapeCheck(badSourceDir, makeCtx())).toMatchObject({ ok: false })
  })

  it('create_team rejects persona_ids that did not round-trip', () => {
    const [createStep] = SCENARIO_STEPS
    const wrongPersonas = makeRawTeam({ persona_ids: ['unexpected-id'] })
    expect(createStep.shapeCheck(wrongPersonas, makeCtx())).toMatchObject({ ok: false })
  })

  it('create_team captures the new id onto ctx.teamId for later steps', () => {
    const [createStep] = SCENARIO_STEPS
    const ctx = makeCtx()
    createStep.capture?.(makeRawTeam({ id: 'team-captured' }), ctx)
    expect(ctx.teamId).toBe('team-captured')
  })

  it('update_team asserts the name and persona_ids change actually took', () => {
    const [, updateStep] = SCENARIO_STEPS
    const ctx = makeCtx({ teamId: 'team-update-check' })

    const args = updateStep.args(ctx) as { input: Record<string, unknown> }
    expect(args.input.id).toBe('team-update-check')

    const unchanged = makeRawTeam({ id: 'team-update-check', name: 'Verify Team' })
    expect(updateStep.shapeCheck(unchanged, ctx)).toMatchObject({ ok: false })

    const changed = makeRawTeam({
      id: 'team-update-check',
      name: 'Verify Team Updated',
      persona_ids: ['verify-team-agent-3']
    })
    expect(updateStep.shapeCheck(changed, ctx)).toEqual({ ok: true })
  })

  it('update_team rejects a result carrying a different team id', () => {
    const [, updateStep] = SCENARIO_STEPS
    const ctx = makeCtx({ teamId: 'team-a' })
    const wrongId = makeRawTeam({ id: 'team-b', name: 'Verify Team Updated', persona_ids: ['verify-team-agent-3'] })
    expect(updateStep.shapeCheck(wrongId, ctx)).toMatchObject({ ok: false })
  })

  it('delete_team sends the bare {id} shape and expects undefined back', () => {
    const [, , deleteStep] = SCENARIO_STEPS
    const ctx = makeCtx({ teamId: 'team-delete-check' })

    const deleteArgs = deleteStep.args(ctx) as { id: string }
    expect(deleteArgs.id).toBe('team-delete-check')
    expect(deleteStep.shapeCheck(undefined, ctx)).toEqual({ ok: true })
    expect(deleteStep.shapeCheck({ id: 'team-delete-check' }, ctx)).toMatchObject({ ok: false })
  })
})
