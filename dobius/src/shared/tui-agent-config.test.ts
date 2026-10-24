import { describe, expect, it } from 'vitest'
import { tuiAgentToAgentKind } from './agent-kind'
import { AGENT_KIND_VALUES } from './telemetry-events'
import {
  getTuiAgentDetectCommands,
  getTuiAgentLaunchCommand,
  isTuiAgent,
  TUI_AGENT_CONFIG
} from './tui-agent-config'
import { ALL_TUI_AGENTS, TUI_AGENT_DISPLAY_NAMES } from './tui-agent-display-names'
import { YOLO_TUI_AGENT_ARGS } from './tui-agent-permissions'
import { TUI_AGENT_AUTO_PICK_ORDER } from './tui-agent-selection'

describe('Trae and Prime Agent catalog entries', () => {
  it('detects and launches Trae through traecli, with trae-cli as an alias', () => {
    const trae = TUI_AGENT_CONFIG.trae
    expect(getTuiAgentDetectCommands(trae)).toEqual(['traecli', 'trae-cli'])
    expect(getTuiAgentLaunchCommand(trae, 'darwin')).toBe('traecli')
    expect(trae.expectedProcess).toBe('traecli')
    expect(trae.promptInjectionMode).toBe('stdin-after-start')
    expect(YOLO_TUI_AGENT_ARGS.trae).toBe('--yolo')
  })

  it('detects and launches Prime Agent through prime-agent with no yolo flag', () => {
    const prime = TUI_AGENT_CONFIG['prime-agent']
    expect(getTuiAgentDetectCommands(prime)).toEqual(['prime-agent'])
    expect(getTuiAgentLaunchCommand(prime, 'linux')).toBe('prime-agent')
    expect(prime.promptInjectionMode).toBe('stdin-after-start')
    expect('prime-agent' in YOLO_TUI_AGENT_ARGS).toBe(false)
  })

  it('registers both agents everywhere the catalog is enumerated', () => {
    for (const id of ['trae', 'prime-agent'] as const) {
      expect(isTuiAgent(id)).toBe(true)
      expect(ALL_TUI_AGENTS).toContain(id)
      expect(TUI_AGENT_AUTO_PICK_ORDER).toContain(id)
      expect(tuiAgentToAgentKind(id)).toBe(id)
      expect(AGENT_KIND_VALUES).toContain(id)
    }
    expect(TUI_AGENT_DISPLAY_NAMES.trae).toBe('Trae')
    expect(TUI_AGENT_DISPLAY_NAMES['prime-agent']).toBe('Prime Agent')
  })

  it('keeps the auto-pick order complete and free of duplicates', () => {
    expect(new Set(TUI_AGENT_AUTO_PICK_ORDER).size).toBe(TUI_AGENT_AUTO_PICK_ORDER.length)
    expect([...TUI_AGENT_AUTO_PICK_ORDER].sort()).toEqual(Object.keys(TUI_AGENT_CONFIG).sort())
  })
})
