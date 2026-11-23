import { describe, expect, it } from 'vitest'
import {
  resolveTerminalTabDetectionTitle,
  resolveTerminalTabTitle,
  resolveUnifiedTabLabel
} from './tab-title-resolution'
import { resolveExplicitTerminalTitleAgentType } from './terminal-title-agent-type'

describe('tab title resolution', () => {
  it('uses live terminal titles when generated titles are disabled', () => {
    expect(
      resolveTerminalTabTitle(
        { customTitle: null, generatedTitle: 'Refactor auth', title: 'Claude working' },
        false
      )
    ).toBe('Claude working')
  })

  it('places generated titles between manual and live titles when enabled', () => {
    expect(
      resolveTerminalTabTitle(
        { customTitle: null, generatedTitle: 'Refactor auth', title: 'Claude working' },
        true
      )
    ).toBe('Refactor auth')
    expect(
      resolveTerminalTabTitle(
        { customTitle: 'Payments', generatedTitle: 'Refactor auth', title: 'Claude working' },
        true
      )
    ).toBe('Payments')
  })

  it('places quick command labels between manual and generated titles', () => {
    expect(
      resolveTerminalTabTitle(
        {
          customTitle: null,
          quickCommandLabel: 'Run tests',
          generatedTitle: 'Refactor auth',
          title: 'pnpm test'
        },
        true
      )
    ).toBe('Run tests')
    expect(
      resolveTerminalTabTitle(
        {
          customTitle: 'Manual label',
          quickCommandLabel: 'Run tests',
          generatedTitle: 'Refactor auth',
          title: 'pnpm test'
        },
        true
      )
    ).toBe('Manual label')
  })

  it('uses the same priority for unified tab labels', () => {
    expect(
      resolveUnifiedTabLabel(
        { customLabel: null, generatedLabel: 'Fix flaky tests', label: 'Codex working' },
        true
      )
    ).toBe('Fix flaky tests')
  })

  it('uses quick command labels before generated unified labels', () => {
    expect(
      resolveUnifiedTabLabel(
        {
          customLabel: null,
          quickCommandLabel: 'Run build',
          generatedLabel: 'Fix flaky tests',
          label: 'Codex working'
        },
        true
      )
    ).toBe('Run build')
  })

  describe('named terminals', () => {
    const named = {
      agentName: 'Juniper',
      customTitle: null,
      generatedTitle: 'Refactor auth',
      title: 'Fix login bug'
    }

    it('shows the name before the live topic', () => {
      expect(resolveTerminalTabTitle(named, false)).toBe('Juniper · Fix login bug')
      expect(resolveTerminalTabTitle(named, true)).toBe('Juniper · Refactor auth')
    })

    it('shows just the name when the live title carries no topic', () => {
      expect(
        resolveTerminalTabTitle({ ...named, generatedTitle: null, title: 'Juniper' }, false)
      ).toBe('Juniper')
      expect(resolveTerminalTabTitle({ ...named, title: 'zsh' }, false)).toBe('Juniper')
    })

    it('lets a manual rename replace the name entirely', () => {
      expect(resolveTerminalTabTitle({ ...named, customTitle: 'Deploy box' }, true)).toBe(
        'Deploy box'
      )
      expect(
        resolveUnifiedTabLabel(
          {
            agentName: 'Juniper',
            customLabel: 'Deploy box',
            generatedLabel: null,
            label: 'Fix login bug'
          },
          false
        )
      ).toBe('Deploy box')
    })

    it('composes unified labels the same way, without doubling the name', () => {
      const unified = resolveUnifiedTabLabel(
        { agentName: 'Juniper', customLabel: null, generatedLabel: null, label: 'Fix login bug' },
        false
      )
      expect(unified).toBe('Juniper · Fix login bug')
      expect(
        resolveTerminalTabTitle({ ...named, generatedTitle: null, title: unified }, false)
      ).toBe(unified)
    })
  })
})

describe('agent-named tab detection title', () => {
  const piTab = {
    customTitle: null,
    generatedTitle: null,
    title: 'π - ~/repo',
    agentName: 'Juniper'
  }

  it('keeps the raw provider title for detection while the label shows the name', () => {
    const label = resolveTerminalTabTitle(piTab, false)
    const detection = resolveTerminalTabDetectionTitle(piTab, false)
    expect(label.startsWith('Juniper')).toBe(true)
    expect(detection).toBe('π - ~/repo')
    expect(resolveExplicitTerminalTitleAgentType(detection)).toBe('pi')
    expect(resolveExplicitTerminalTitleAgentType(label)).toBeNull()
  })

  it('keeps manual and quick-command precedence for detection', () => {
    expect(resolveTerminalTabDetectionTitle({ ...piTab, customTitle: 'Payments' }, false)).toBe(
      'Payments'
    )
    expect(
      resolveTerminalTabDetectionTitle({ ...piTab, quickCommandLabel: 'Run tests' }, false)
    ).toBe('Run tests')
  })
})
