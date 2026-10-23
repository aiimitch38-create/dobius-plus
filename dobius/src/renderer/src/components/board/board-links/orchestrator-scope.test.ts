import { describe, expect, it } from 'vitest'
import { routeOrchestratorMessage } from './orchestrator-scope'

const wired = [
  { cardId: 'c1', title: 'Claude 1' },
  { cardId: 'c10', title: 'Claude 10' },
  { cardId: 'x', title: 'Codex' }
]

describe('routeOrchestratorMessage', () => {
  it('broadcasts plain text to every wired console', () => {
    expect(routeOrchestratorMessage('  run the tests ', wired)).toEqual({
      kind: 'all',
      text: 'run the tests'
    })
  })

  it('routes @Name to one wired console, longest title first, case-insensitive', () => {
    expect(routeOrchestratorMessage('@claude 10 fix lint', wired)).toEqual({
      kind: 'one',
      cardId: 'c10',
      text: 'fix lint'
    })
    expect(routeOrchestratorMessage('@Claude 1 fix lint', wired)).toEqual({
      kind: 'one',
      cardId: 'c1',
      text: 'fix lint'
    })
    expect(routeOrchestratorMessage('@Codex review', wired)).toMatchObject({ cardId: 'x' })
  })

  it('refuses a mention outside the wired set, or with no message', () => {
    expect(routeOrchestratorMessage('@Gemini hi', wired)).toEqual({
      kind: 'refuse',
      reason: 'outside-scope'
    })
    expect(routeOrchestratorMessage('@Codexer hi', wired)).toEqual({
      kind: 'refuse',
      reason: 'outside-scope'
    })
    expect(routeOrchestratorMessage('@Codex', wired)).toEqual({
      kind: 'refuse',
      reason: 'outside-scope'
    })
  })

  it('refuses workspace actions and undo/redo', () => {
    expect(routeOrchestratorMessage('open the next workspace', wired)).toMatchObject({
      reason: 'workspace'
    })
    expect(routeOrchestratorMessage('Switch to workspace 2', wired)).toMatchObject({
      reason: 'workspace'
    })
    expect(routeOrchestratorMessage('undo that', wired)).toMatchObject({ reason: 'undo' })
  })

  it('refuses a broadcast with nothing wired', () => {
    expect(routeOrchestratorMessage('go', [])).toEqual({ kind: 'refuse', reason: 'nothing-wired' })
  })
})
