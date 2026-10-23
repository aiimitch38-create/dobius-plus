import { describe, expect, it } from 'vitest'
import { PlannerBreaker, fallbackParse } from './plan-fallback'

const step = (text: string) => {
  const r = fallbackParse(text)
  return r.kind === 'plan' ? r.plan.steps[0] : r.kind
}

describe('fallbackParse', () => {
  it('handles simple board commands in several languages', () => {
    expect(step('spawn 4 claude')).toMatchObject({ kind: 'spawn', count: 4, cli: 'claude' })
    expect(step('spawn 4 claude')).toMatchObject({ brief: '' })
    expect(step('spawn claude')).toMatchObject({ kind: 'spawn', count: 1, cli: 'claude' })
    expect(step('spawn two codex consoles')).toMatchObject({ count: 2, cli: 'codex' })
    expect(step('lanza tres gemini')).toMatchObject({ count: 3, cli: 'gemini' })
    expect(step('pause all')).toEqual({ kind: 'pause', target: 'all' })
    expect(step('pausa todos')).toEqual({ kind: 'pause', target: 'all' })
    expect(step('resume everyone')).toEqual({ kind: 'resume', target: 'all' })
    expect(step('open memory')).toEqual({ kind: 'open_studio', target: 'memory' })
    expect(step('dark mode')).toEqual({ kind: 'set_theme', target: 'dark' })
    expect(step('Who finished?')).toEqual({ kind: 'report' })
    expect(step('undo')).toEqual({ kind: 'undo' })
  })
  it('refuses to write work orders', () => {
    expect(step('refactor the auth module and add tests')).toBe('work-order')
    expect(step('spawn 3 bananas')).toBe('work-order')
  })
})

describe('PlannerBreaker', () => {
  it('opens after repeated failures for the cool-down, then closes', () => {
    const b = new PlannerBreaker(2, 60_000)
    b.recordFailure(0)
    expect(b.isOpen(1)).toBe(false)
    b.recordFailure(10)
    expect(b.isOpen(20)).toBe(true)
    expect(b.isOpen(60_011)).toBe(false)
  })
  it('success resets the count', () => {
    const b = new PlannerBreaker(2, 1_000)
    b.recordFailure(0)
    b.recordSuccess()
    b.recordFailure(1)
    expect(b.isOpen(2)).toBe(false)
  })
})
