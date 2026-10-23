import React from 'react'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import type { AgentChoice } from './document-generation-agents'

export function agentDisplayName(agent: string): string {
  return isTuiAgent(agent) ? getAgentLabel(agent) : agent
}

const CHIP_CLASS =
  'flex items-center gap-1.5 rounded-full border border-[var(--board-panel-border)] px-3 py-1 text-[12px] text-[var(--board-text)] hover:bg-[var(--board-panel-2)] aria-pressed:border-[var(--board-accent)] aria-pressed:bg-[var(--board-accent-tint)] disabled:opacity-40'

/**
 * Pick the agent CLI that does a studio job (Claude, Codex, Gemini…), and,
 * when that CLI runs in several consoles, which console. Shared by the Docs
 * and Memory studios.
 */
export function AgentCliPicker({
  choices,
  agent,
  tabId,
  disabled,
  onPick
}: {
  choices: readonly AgentChoice[]
  agent: string | null
  tabId: string | null
  disabled?: boolean
  onPick: (agent: string, tabId: string) => void
}): React.JSX.Element {
  const current = choices.find((c) => c.agent === agent) ?? null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {choices.map((choice) => (
        <button
          key={choice.agent}
          type="button"
          disabled={disabled}
          aria-pressed={choice.agent === current?.agent}
          onClick={() => onPick(choice.agent, choice.consoles[0].tabId)}
          className={CHIP_CLASS}
        >
          <AgentIcon agent={isTuiAgent(choice.agent) ? choice.agent : null} size={13} />
          {agentDisplayName(choice.agent)}
        </button>
      ))}
      {current && current.consoles.length > 1 ? (
        <select
          value={tabId ?? current.consoles[0].tabId}
          disabled={disabled}
          onChange={(e) => onPick(current.agent, e.target.value)}
          aria-label={translate('board.studio.agentPicker.console', 'Console')}
          className="rounded-[8px] border border-[var(--board-panel-border)] bg-transparent px-2 py-1 text-[12px] text-[var(--board-text)]"
        >
          {current.consoles.map((c) => (
            <option key={c.tabId} value={c.tabId}>
              {c.title}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )
}
