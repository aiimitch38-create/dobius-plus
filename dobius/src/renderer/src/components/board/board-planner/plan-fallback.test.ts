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

describe('fallbackParse loops and git', () => {
  it('reads "every N minutes" as a loop on every console, with an optional stop command', () => {
    expect(step('every 10 minutes run the tests')).toEqual({
      kind: 'loop',
      text: 'run the tests',
      intervalMinutes: 10,
      target: null,
      stopCommand: null
    })
    expect(step('every 2 hours check the build until pnpm test passes')).toMatchObject({
      intervalMinutes: 120,
      text: 'check the build',
      stopCommand: 'pnpm test'
    })
  })
  it('reads commit, commit and push, push and pull as git steps', () => {
    expect(step('commit and push')).toEqual({ kind: 'git', target: 'commit_push', text: null })
    expect(step('commit and push with message "fix login"')).toEqual({
      kind: 'git',
      target: 'commit_push',
      text: 'fix login'
    })
    expect(step('commit with message tidy imports')).toEqual({
      kind: 'git',
      target: 'commit',
      text: 'tidy imports'
    })
    expect(step('push')).toEqual({ kind: 'git', target: 'push', text: null })
    expect(step('pull')).toEqual({ kind: 'git', target: 'pull', text: null })
  })
})

describe('fallbackParse loop targets', () => {
  it.each([
    ['every 10 minutes tell Claude 1 to run the tests', 'Claude 1', 'run the tests', 10],
    ['every 10 minutes, ask Codex 1 to check the build', 'Codex 1', 'check the build', 10],
    ['every 5 min have Team A to rerun lint', 'Team A', 'rerun lint', 5],
    ['every hour tell the Team A group: summarize progress', 'Team A', 'summarize progress', 60],
    ['every 15 minutes @Claude 2: pull and rebase', 'Claude 2', 'pull and rebase', 15],
    ['tell Claude 1 to run the tests every 10 minutes', 'Claude 1', 'run the tests', 10],
    ['every 10 minutes tell everyone to save their work', 'everyone', 'save their work', 10]
  ])('"%s" targets %s', (utterance, target, text, minutes) => {
    expect(step(utterance)).toMatchObject({ kind: 'loop', target, text, intervalMinutes: minutes })
  })

  it('keeps no target (every console) only when nobody is named', () => {
    expect(step('every 10 minutes run the tests')).toMatchObject({ target: null })
    expect(step('every 10 minutes check whether the build passed')).toMatchObject({
      target: null,
      text: 'check whether the build passed'
    })
  })

  it('keeps the stop command with a named target', () => {
    expect(
      step('every 2 hours tell Claude 1 to check the build until pnpm test passes')
    ).toMatchObject({ target: 'Claude 1', text: 'check the build', stopCommand: 'pnpm test' })
  })
})
