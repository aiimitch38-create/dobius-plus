import { SquareTerminal } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import type { PresetAgent } from './preset-catalog'

export function presetAgentLabel(agent: PresetAgent): string {
  return agent === 'shell'
    ? translate('board.presets.agent.shell', 'Terminal')
    : getAgentLabel(agent)
}

/** Dobius's own agent icons from the agent registry; a terminal glyph for plain shells. */
export function PresetAgentIcon({
  agent,
  size = 14
}: {
  agent: PresetAgent
  size?: number
}): React.JSX.Element {
  return agent === 'shell' ? (
    <SquareTerminal
      style={{ width: size, height: size }}
      className="text-[var(--board-text-muted)]"
    />
  ) : (
    <AgentIcon agent={agent} size={size} />
  )
}
