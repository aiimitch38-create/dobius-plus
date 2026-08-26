import { describe, expect, it } from 'vitest'
import type { ScenarioContext } from '../scenario-contract'
import { SCENARIO_STEPS } from './agents.scenarios'

// Why: exercises this family's own args/shapeCheck logic against fabricated
// results standing in for what the real gateway handlers return (see
// communications-agent-methods.ts) — mirrors workflows/workflows style. Does
// not replace a real harness run; guards the fixture logic itself so a typo
// in a shapeCheck can't silently start passing malformed shapes.
function makeCtx(overrides: Partial<ScenarioContext> = {}): ScenarioContext {
  return { selfPubkey: 'self-pubkey', otherPubkey: 'other-pubkey', family: {}, ...overrides }
}

function findStep(command: string) {
  const step = SCENARIO_STEPS.find((candidate) => candidate.command === command)
  if (!step) {
    throw new Error(`no scenario step registered for ${command}`)
  }
  return step
}

describe('agents family scenario fixtures', () => {
  it('every command name is unique (the harness invariant this whole family must respect)', () => {
    const commands = SCENARIO_STEPS.map((step) => step.command)
    expect(new Set(commands).size).toBe(commands.length)
  })

  it('every step dispatches an RPC method name over the gateway seam (no vendor names left)', () => {
    for (const step of SCENARIO_STEPS) {
      expect(step.via).toBe('method')
      // Vendor Tauri commands were snake_case; RPC methods are dot-namespaced
      // camelCase — a leftover underscore means an unported step.
      expect(step.command).not.toMatch(/_/)
    }
  })

  it('agentObserverIndex.write asserts the honest indexed count', () => {
    const ctx = makeCtx()
    const step = findStep('agentObserverIndex.write')
    const args = step.args(ctx) as { entries: unknown[] }
    expect(args.entries).toHaveLength(1)
    expect(step.shapeCheck({ indexed: 1 }, ctx)).toEqual({ ok: true })
    expect(step.shapeCheck({ indexed: 2 }, ctx)).toMatchObject({ ok: false })
    expect(step.shapeCheck(undefined, ctx)).toMatchObject({ ok: false })
  })

  it('the observer index steps share one synthesized channel/event id and use the structured cursor', () => {
    const ctx = makeCtx()
    const writeArgs = findStep('agentObserverIndex.write').args(ctx) as {
      entries: { eventId: string; channelId: string }[]
    }
    const readStep = findStep('agentObserverIndex.readForChannel')
    const readArgs = readStep.args(ctx) as { channelId: string; before: unknown; limit: number }
    expect(readArgs.channelId).toBe(writeArgs.entries[0].channelId)
    expect(readArgs.before).toBeNull()
    expect(readArgs.limit).toBe(10)

    const row = {
      eventId: writeArgs.entries[0].eventId,
      channelId: writeArgs.entries[0].channelId,
      createdAt: 1234
    }
    expect(readStep.shapeCheck({ entries: [row] }, ctx)).toEqual({ ok: true })
    expect(readStep.shapeCheck({ entries: [] }, ctx)).toMatchObject({ ok: false })
    expect(readStep.shapeCheck({ entries: [{ ...row, eventId: 'other-event' }] }, ctx)).toMatchObject({ ok: false })
    expect(readStep.shapeCheck({ entries: [{ ...row, channelId: 'other-channel' }] }, ctx)).toMatchObject({
      ok: false
    })
    expect(readStep.shapeCheck({}, ctx)).toMatchObject({ ok: false })
  })

  it('agentApprovals.listForRun expects the { approvals } envelope', () => {
    const ctx = makeCtx()
    const step = findStep('agentApprovals.listForRun')
    expect(step.args(ctx)).toEqual({ runId: 'agents-verify-run' })
    expect(step.shapeCheck({ approvals: [] }, ctx)).toEqual({ ok: true })
    expect(step.shapeCheck([], ctx)).toMatchObject({ ok: false })
  })

  it('agentConfig.get asserts the { config } wrapper and its four-field contract', () => {
    const ctx = makeCtx()
    const step = findStep('agentConfig.get')
    expect(step.args(ctx)).toEqual({})
    expect(
      step.shapeCheck({ config: { env_vars: {}, provider: null, model: null, preferred_runtime: null } }, ctx)
    ).toEqual({ ok: true })
    expect(step.shapeCheck({ env_vars: {} }, ctx)).toMatchObject({ ok: false })
    expect(
      step.shapeCheck({ config: { env_vars: 'nope', provider: null, model: null, preferred_runtime: null } }, ctx)
    ).toMatchObject({ ok: false })
  })

  it('agentConfig.set sends the flattened config and asserts persistence plus honest restart counts', () => {
    const ctx = makeCtx()
    const step = findStep('agentConfig.set')
    expect(step.args(ctx)).toEqual({
      env_vars: { AGENTS_VERIFY: 'probe' },
      provider: 'anthropic',
      model: null,
      preferred_runtime: 'claude'
    })
    expect(
      step.shapeCheck({ config: { env_vars: { AGENTS_VERIFY: 'probe' } }, restarted_count: 0, failed_restart_count: 0 }, ctx)
    ).toEqual({ ok: true })
    expect(
      step.shapeCheck({ config: { env_vars: {} }, restarted_count: 0, failed_restart_count: 0 }, ctx)
    ).toMatchObject({ ok: false })
    expect(
      step.shapeCheck({ config: { env_vars: { AGENTS_VERIFY: 'probe' } }, restarted_count: 3, failed_restart_count: 0 }, ctx)
    ).toMatchObject({ ok: false })
  })

  it('agentManagedProfiles set/get round-trip the stored boolean through both envelopes', () => {
    const ctx = makeCtx()
    const set = findStep('agentManagedProfiles.set')
    expect(set.args(ctx)).toEqual({ enabled: true })
    expect(set.shapeCheck({ enabled: true }, ctx)).toEqual({ ok: true })
    expect(set.shapeCheck(undefined, ctx)).toMatchObject({ ok: false })

    const get = findStep('agentManagedProfiles.get')
    expect(get.args(ctx)).toEqual({})
    expect(get.shapeCheck({ enabled: true }, ctx)).toEqual({ ok: true })
    expect(get.shapeCheck({ enabled: false }, ctx)).toMatchObject({ ok: false })
  })

  it('agentHarness.save asserts the persisted definition fields rather than any object', () => {
    const ctx = makeCtx()
    const step = findStep('agentHarness.save')
    const args = step.args(ctx) as { definition: { id: string }; originalId: unknown }
    expect(args.definition.id).toBe('agents-verify-harness')

    const saved = {
      harness: { id: 'agents-verify-harness', label: 'Agents Verify Harness', command: 'agents-verify-harness-cli' }
    }
    expect(step.shapeCheck(saved, ctx)).toEqual({ ok: true })
    expect(step.shapeCheck({ harness: { ...saved.harness, command: 'other-cli' } }, ctx)).toMatchObject({ ok: false })
    expect(step.shapeCheck({ id: 'agents-verify-harness' }, ctx)).toMatchObject({ ok: false })
  })

  it('agentHarness.delete asserts what the store removed', () => {
    const ctx = makeCtx()
    const step = findStep('agentHarness.delete')
    expect(step.args(ctx)).toEqual({ id: 'agents-verify-harness' })
    expect(step.shapeCheck({ removed: true, id: 'agents-verify-harness' }, ctx)).toEqual({ ok: true })
    expect(step.shapeCheck({ removed: true, id: 'other' }, ctx)).toMatchObject({ ok: false })
    expect(step.shapeCheck(undefined, ctx)).toMatchObject({ ok: false })
  })
})
