import { describe, expect, it } from 'vitest'
import { LIVE_COMMENTARY_TOKEN_BUDGET, estimateTokens, fitTokens } from './live-voice-tokens'
import { LIVE_WORD_FOR_WORD_LEAD, spokenFor } from './live-voice-spoken'

describe('commentary token budget (7.13 review)', () => {
  it('keeps the whole word-for-word commentary, lead-in included, under the budget for dense text', () => {
    const dense = '本日のビルドは成功しました。テストも全部通りました'.repeat(40)
    const say = spokenFor({ kind: 'answer', text: dense }, true)
    expect(say.startsWith(LIVE_WORD_FOR_WORD_LEAD)).toBe(true)
    expect(estimateTokens(say)).toBeLessThanOrEqual(LIVE_COMMENTARY_TOKEN_BUDGET)
    expect(say.endsWith('The rest is in the thread.')).toBe(true)
  })

  it('budgets mixed scripts and emoji as well', () => {
    const mixed = 'Готово ✅ 完了 — tests passed! '.repeat(60)
    expect(estimateTokens(spokenFor({ kind: 'answer', text: mixed }, true))).toBeLessThanOrEqual(
      LIVE_COMMENTARY_TOKEN_BUDGET
    )
  })

  it('leaves a short answer untouched', () => {
    expect(spokenFor({ kind: 'answer', text: 'The port is 8421.' }, true)).toBe(
      `${LIVE_WORD_FOR_WORD_LEAD}The port is 8421.`
    )
  })

  it('cuts at a sentence end when one is near', () => {
    const text = `${'First sentence here. '.repeat(30)}tail words that run on and on`
    const fitted = fitTokens(text, 100)
    expect(estimateTokens(fitted)).toBeLessThanOrEqual(100)
    expect(fitted).toMatch(/here\. The rest is in the thread\.$/)
  })
})
