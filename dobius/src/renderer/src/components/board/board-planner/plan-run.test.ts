import { describe, expect, it, vi } from 'vitest'
import { PlannerBreaker } from './plan-fallback'
import { BOARD } from './plan-fixtures.test-support'
import { runPlanner } from './plan-run'

const base = (transport: (p: string) => Promise<string>, utterance = 'zoom in') => ({
  transport,
  breaker: new PlannerBreaker(2, 60_000),
  board: BOARD,
  turns: [],
  utterance,
  replyLanguage: 'en',
  now: () => 0
})

describe('runPlanner', () => {
  it('returns a validated planner plan', async () => {
    const out = await runPlanner(
      base(async () => '{"steps":[{"kind":"zoom_in"}],"say":"Zoomed in."}')
    )
    expect(out).toMatchObject({
      kind: 'plan',
      source: 'planner',
      plan: { steps: [{ kind: 'zoom_in' }] }
    })
  })

  it('retries once with the rejection reason in app_note', async () => {
    const transport = vi
      .fn<(p: string) => Promise<string>>()
      .mockResolvedValueOnce('{"steps":[{"kind":"explode"}],"say":""}')
      .mockResolvedValueOnce('{"steps":[{"kind":"zoom_in"}],"say":"Zoomed in."}')
    const out = await runPlanner(base(transport))
    expect(out.kind).toBe('plan')
    expect(transport.mock.calls[1][0]).toContain('unknown step kind "explode"')
  })

  it('gives up after the retry is also invalid', async () => {
    const out = await runPlanner(base(async () => '{"steps":[{"kind":"explode"}],"say":""}'))
    expect(out).toMatchObject({ kind: 'rejected' })
  })

  it('treats a reply with no JSON (CLI error text) as planner down, without retrying', async () => {
    const transport = vi.fn(async () => 'Error: You are out of credits.')
    expect(await runPlanner(base(transport, 'pause all'))).toMatchObject({
      kind: 'plan',
      source: 'fallback'
    })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(await runPlanner(base(transport, 'fix the login bug'))).toMatchObject({
      kind: 'needs-planner',
      reason: 'Error: You are out of credits.'
    })
  })

  it('falls back to the parser when the planner is down, and refuses work orders', async () => {
    const down = async (): Promise<string> => {
      throw new Error('rate limited')
    }
    expect(await runPlanner(base(down, 'pause all'))).toMatchObject({
      kind: 'plan',
      source: 'fallback'
    })
    expect(await runPlanner(base(down, 'fix the login bug'))).toMatchObject({
      kind: 'needs-planner',
      reason: 'rate limited'
    })
  })

  it('skips the planner entirely while the breaker is open', async () => {
    const transport = vi.fn(async () => '{"steps":[],"say":"hi"}')
    const input = base(transport, 'zoom in')
    input.breaker.recordFailure(0)
    input.breaker.recordFailure(0)
    expect(await runPlanner(input)).toMatchObject({ source: 'fallback' })
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('planner prompt', () => {
  it('carries both lens catalogs for review splits', async () => {
    const { buildPlannerPrompt, CODE_REVIEW_LENSES, DESIGN_REVIEW_LENSES } =
      await import('./plan-prompt')
    const prompt = buildPlannerPrompt({
      board: BOARD,
      turns: [],
      utterance: 'review it',
      replyLanguage: 'en',
      appNote: null
    })
    expect(DESIGN_REVIEW_LENSES).toHaveLength(12)
    expect(CODE_REVIEW_LENSES).toHaveLength(8)
    for (const lens of [...DESIGN_REVIEW_LENSES, ...CODE_REVIEW_LENSES]) {
      expect(prompt).toContain(lens)
    }
  })
})

describe('near-miss names', () => {
  it('returns did-you-mean instead of retrying when a target is a near miss', async () => {
    const transport = vi.fn(
      async () => '{"steps":[{"kind":"tell","target":"Codx 1","text":"run the tests"}],"say":""}'
    )
    const out = await runPlanner(base(transport, 'tell codx 1 to run the tests'))
    expect(out).toMatchObject({
      kind: 'did-you-mean',
      suggestion: { from: 'Codx 1', to: 'Codex 1' }
    })
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
