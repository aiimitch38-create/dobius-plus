import { describe, expect, it } from 'vitest'
import type { ScenarioContext } from './scenario-contract'
import { SCENARIO_STEPS } from './teams.scenarios'

// Why: exercises the fixtures' own args/shapeCheck/capture logic against
// fabricated { team }-wrapped camelCase Team results (team-store.ts's
// record shape), standing in for what the real team.* RPC methods return
// over the gateway. This does not replace the real harness run — see
// run-verification's HARNESS_EFFECT reporting for that — it guards the
// fixture logic itself, so a typo in isTeamRecordShape can't silently start
// passing malformed shapes.
function makeCtx(overrides: Partial<ScenarioContext> = {}): ScenarioContext {
  return { selfPubkey: 'self', otherPubkey: 'other', family: {}, ...overrides }
}

function makeTeamResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    team: {
      id: 'team-1',
      name: 'Verify Team',
      description: 'verification department',
      instructions: 'Be helpful',
      personaIds: ['verify-team-agent-1', 'verify-team-agent-2'],
      accountIds: [],
      createdAt: 1767225600000,
      updatedAt: 1767225600000,
      ...overrides
    }
  }
}

describe('team scenario fixtures', () => {
  it('orders steps team.create -> team.update -> team.delete (no team.list — already core-owned)', () => {
    expect(SCENARIO_STEPS.map((step) => step.command)).toEqual([
      'team.create',
      'team.update',
      'team.delete'
    ])
    expect(SCENARIO_STEPS.every((step) => step.via === 'method')).toBe(true)
  })

  it('team.create sends flat params and passes on a matching full record', () => {
    const [createStep] = SCENARIO_STEPS
    const args = createStep.args(makeCtx()) as Record<string, unknown>
    expect(args).toMatchObject({ name: 'Verify Team', personaIds: expect.any(Array) })
    // The vendor switch's { input } wrapper is retired — params are top-level.
    expect(args.input).toBeUndefined()

    const result = makeTeamResult()
    expect(createStep.shapeCheck(result, makeCtx())).toEqual({ ok: true })
    createStep.capture?.(result, makeCtx())
  })

  it('team.create rejects a non-{team} wrapper and missing/ill-typed fields', () => {
    const [createStep] = SCENARIO_STEPS
    expect(createStep.shapeCheck({ id: 'team-1' }, makeCtx())).toMatchObject({ ok: false })
    expect(createStep.shapeCheck(makeTeamResult({ createdAt: 'not-a-number' }), makeCtx())).toMatchObject({
      ok: false
    })
    const noAccounts = makeTeamResult()
    if (!('team' in noAccounts) || typeof noAccounts.team !== 'object' || noAccounts.team === null) {
      throw new Error('fixture lost its team record')
    }
    delete (noAccounts.team as Record<string, unknown>).accountIds
    expect(createStep.shapeCheck(noAccounts, makeCtx())).toMatchObject({ ok: false })
  })

  it('team.create rejects personaIds that did not round-trip', () => {
    const [createStep] = SCENARIO_STEPS
    const wrongPersonas = makeTeamResult({
      personaIds: ['unexpected-id']
    })
    expect(createStep.shapeCheck(wrongPersonas, makeCtx())).toMatchObject({ ok: false })
  })

  it('team.create captures the new id onto ctx.teamId for later steps', () => {
    const [createStep] = SCENARIO_STEPS
    const ctx = makeCtx()
    createStep.capture?.(makeTeamResult({ id: 'team-captured' }), ctx)
    expect(ctx.teamId).toBe('team-captured')
  })

  it('team.update sends {id, updates} and asserts every change actually took', () => {
    const [, updateStep] = SCENARIO_STEPS
    const ctx = makeCtx({ teamId: 'team-update-check' })

    const args = updateStep.args(ctx) as { id: string; updates: Record<string, unknown> }
    expect(args.id).toBe('team-update-check')
    expect(args.updates).toMatchObject({ name: 'Verify Team Updated', personaIds: expect.any(Array) })

    const unchanged = makeTeamResult({ id: 'team-update-check', name: 'Verify Team' })
    expect(updateStep.shapeCheck(unchanged, ctx)).toMatchObject({ ok: false })

    const changed = makeTeamResult({
      id: 'team-update-check',
      name: 'Verify Team Updated',
      description: 'updated department',
      instructions: 'Be kind',
      personaIds: ['verify-team-agent-3']
    })
    expect(updateStep.shapeCheck(changed, ctx)).toEqual({ ok: true })
  })

  it('team.update rejects a result carrying a different team id or stale fields', () => {
    const [, updateStep] = SCENARIO_STEPS
    const ctx = makeCtx({ teamId: 'team-a' })
    const wrongId = makeTeamResult({
      id: 'team-b',
      name: 'Verify Team Updated',
      description: 'updated department',
      instructions: 'Be kind',
      personaIds: ['verify-team-agent-3']
    })
    expect(updateStep.shapeCheck(wrongId, ctx)).toMatchObject({ ok: false })

    const stalePersonas = makeTeamResult({
      id: 'team-a',
      name: 'Verify Team Updated',
      description: 'updated department',
      instructions: 'Be kind',
      personaIds: ['verify-team-agent-1']
    })
    expect(updateStep.shapeCheck(stalePersonas, ctx)).toMatchObject({ ok: false })
  })

  it('team.delete sends bare {id} and expects {removed:true,id} back', () => {
    const [, , deleteStep] = SCENARIO_STEPS
    const ctx = makeCtx({ teamId: 'team-delete-check' })

    const deleteArgs = deleteStep.args(ctx) as { id: string }
    expect(deleteArgs.id).toBe('team-delete-check')
    expect(deleteStep.shapeCheck({ removed: true, id: 'team-delete-check' }, ctx)).toEqual({ ok: true })
    expect(deleteStep.shapeCheck(undefined, ctx)).toMatchObject({ ok: false })
    expect(deleteStep.shapeCheck({ removed: true, id: 'other-team' }, ctx)).toMatchObject({ ok: false })
  })
})
