import { describe, expect, it } from 'vitest'
import { BOARD } from './plan-fixtures.test-support'
import { agentKindFor, nearestName, resolveTarget } from './plan-target'

describe('resolveTarget', () => {
  it('resolves all, names, groups, agent kinds and roles', () => {
    expect(resolveTarget('all', BOARD)).toMatchObject({
      kind: 'consoles',
      names: ['Claude 1', 'Claude 2', 'Codex 1']
    })
    expect(resolveTarget('@claude 2', BOARD)).toEqual({
      kind: 'consoles',
      names: ['Claude 2'],
      via: 'console'
    })
    expect(resolveTarget('team a', BOARD)).toMatchObject({
      kind: 'group',
      members: ['Claude 1', 'Claude 2']
    })
    expect(resolveTarget('Claude Code', BOARD)).toMatchObject({
      names: ['Claude 1', 'Claude 2'],
      via: 'agent'
    })
    expect(resolveTarget('frontend', BOARD)).toMatchObject({ names: ['Claude 2'], via: 'role' })
    expect(resolveTarget('Claude 1, Codex 1', BOARD)).toMatchObject({
      names: ['Claude 1', 'Codex 1']
    })
  })
  it('never invents a target', () => {
    expect(resolveTarget('Gemini', BOARD)).toBeNull()
    expect(resolveTarget('Reviewer 9', BOARD)).toBeNull()
    expect(resolveTarget('Claude 1, Ghost', BOARD)).toBeNull()
  })
})

describe('speech-to-text agent quirks', () => {
  it('maps mishearings to agents', () => {
    expect(agentKindFor('Cloud')).toBe('claude')
    expect(agentKindFor('codecs')).toBe('codex')
    expect(agentKindFor('aws')).toBeNull()
  })
})

describe('nearestName', () => {
  it('suggests close misses only', () => {
    expect(nearestName('Clade 1', BOARD)).toBe('Claude 1')
    expect(nearestName('Totally different', BOARD)).toBeNull()
  })
})
