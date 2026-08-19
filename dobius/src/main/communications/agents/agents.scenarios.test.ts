import { describe, expect, it } from 'vitest'
import type { ScenarioContext } from '../scenario-contract'
import { SCENARIO_STEPS } from './agents.scenarios'

// Why: exercises this family's own args/shapeCheck/capture logic against
// fabricated results standing in for what the real vendor case blocks (see
// the handoff report's SWITCH_CASES) would return — mirrors
// teams.scenarios.test.ts's precedent. Does not replace a real harness run;
// guards the fixture logic itself so a typo in a shapeCheck can't silently
// start passing malformed shapes.
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

  it('build_observer_control_event addresses the event to otherPubkey and rejects an unencrypted passthrough', () => {
    const step = findStep('build_observer_control_event')
    const ctx = makeCtx()
    const args = step.args(ctx) as { agentPubkey: string; payload: unknown }
    expect(args.agentPubkey).toBe(ctx.otherPubkey)

    const plaintext = JSON.stringify(args.payload)
    const fakePassthrough = JSON.stringify({
      kind: 24200,
      content: plaintext,
      tags: [['p', ctx.otherPubkey]],
      sig: 'a'.repeat(64),
      id: 'b'.repeat(64)
    })
    expect(step.shapeCheck(fakePassthrough, ctx)).toMatchObject({ ok: false })

    const realish = JSON.stringify({
      kind: 24200,
      content: 'ciphertext-not-the-plaintext',
      tags: [['p', ctx.otherPubkey]],
      sig: 'a'.repeat(64),
      id: 'b'.repeat(64)
    })
    expect(step.shapeCheck(realish, ctx)).toEqual({ ok: true })
  })

  it('build_observer_control_event rejects the wrong kind or a missing p-tag', () => {
    const step = findStep('build_observer_control_event')
    const ctx = makeCtx()
    const wrongKind = JSON.stringify({
      kind: 1,
      content: 'ciphertext',
      tags: [['p', ctx.otherPubkey]],
      sig: 'a'.repeat(64),
      id: 'b'.repeat(64)
    })
    expect(step.shapeCheck(wrongKind, ctx)).toMatchObject({ ok: false })

    const noTag = JSON.stringify({ kind: 24200, content: 'ciphertext', tags: [], sig: 'a'.repeat(64), id: 'b'.repeat(64) })
    expect(step.shapeCheck(noTag, ctx)).toMatchObject({ ok: false })
  })

  it('build_observer_control_event captures the raw event JSON onto ctx.family for decrypt to consume', () => {
    const step = findStep('build_observer_control_event')
    const ctx = makeCtx()
    step.capture?.('{"kind":24200}', ctx)
    expect(ctx.family.agentsObserverControlEventJson).toBe('{"kind":24200}')
  })

  it('decrypt_observer_event reads the captured event JSON and checks the round-tripped payload', () => {
    const step = findStep('decrypt_observer_event')
    const ctx = makeCtx({ family: { agentsObserverControlEventJson: 'captured-json' } })
    const args = step.args(ctx) as { eventJson: string }
    expect(args.eventJson).toBe('captured-json')

    expect(step.shapeCheck({ type: 'verify_probe', nonce: 'agents-scenario-observer' }, ctx)).toEqual({ ok: true })
    expect(step.shapeCheck({ type: 'wrong' }, ctx)).toMatchObject({ ok: false })
  })

  it('has_managed_agent_channel_message_marker expects false for an unsent marker', () => {
    const step = findStep('has_managed_agent_channel_message_marker')
    const ctx = makeCtx()
    expect(step.shapeCheck(false, ctx)).toEqual({ ok: true })
    expect(step.shapeCheck(true, ctx)).toMatchObject({ ok: false })
  })

  it('the constant-returning provider/config steps assert the exact honest values', () => {
    const ctx = makeCtx()
    expect(findStep('get_baked_build_env').shapeCheck([], ctx)).toEqual({ ok: true })
    expect(findStep('get_baked_build_env_keys').shapeCheck(['LEAK'], ctx)).toMatchObject({ ok: false })
    expect(findStep('get_runtime_file_config').shapeCheck(null, ctx)).toEqual({ ok: true })
    expect(findStep('get_runtime_file_config').shapeCheck({}, ctx)).toMatchObject({ ok: false })
    expect(findStep('observer_archive_default_enabled').shapeCheck(false, ctx)).toEqual({ ok: true })
    expect(findStep('observer_archive_default_enabled').shapeCheck(true, ctx)).toMatchObject({ ok: false })
    expect(findStep('agent_metric_archive_default_enabled').shapeCheck(false, ctx)).toEqual({ ok: true })
  })

  it('save_custom_harness asserts the real persisted id/source rather than any object', () => {
    const step = findStep('save_custom_harness')
    const ctx = makeCtx()
    expect(step.shapeCheck({ id: 'agents-verify-harness', source: 'custom' }, ctx)).toEqual({ ok: true })
    expect(step.shapeCheck({ id: 'agents-verify-harness', source: 'builtin' }, ctx)).toMatchObject({ ok: false })
    expect(step.shapeCheck({}, ctx)).toMatchObject({ ok: false })
  })

  it('set_global_agent_config asserts the sent env var actually persisted', () => {
    const step = findStep('set_global_agent_config')
    const ctx = makeCtx()
    expect(
      step.shapeCheck({ config: { env_vars: { AGENTS_VERIFY: 'probe' } }, restarted_count: 0 }, ctx)
    ).toEqual({ ok: true })
    expect(
      step.shapeCheck({ config: { env_vars: {} }, restarted_count: 0 }, ctx)
    ).toMatchObject({ ok: false })
  })

  it('index_observer_channel_id and read_archived_observer_events_for_channel reuse the same synthesized channel id', () => {
    const ctx = makeCtx()
    const indexArgs = findStep('index_observer_channel_id').args(ctx) as {
      entries: { channelId: string }[]
    }
    const readArgs = findStep('read_archived_observer_events_for_channel').args(ctx) as { channelId: string }
    expect(indexArgs.entries[0].channelId).toBe(readArgs.channelId)
  })
})
