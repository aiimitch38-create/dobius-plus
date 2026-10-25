import React from 'react'
import { translate } from '@/i18n/i18n'
import type { AgentPresence } from './agent-presence-state'

/** Tip of the arrow inside the 20x24 glyph; the layer offsets by this so the tip is the hotspot. */
export const AGENT_CURSOR_HOTSPOT = { x: 3, y: 2.5 }
/** Name pill anchor relative to the hotspot (research §6.1). */
const PILL_OFFSET = { x: 14, y: 18 }
const NAME_MAX_CHARS = 18

// Rounded northwest pointer (owner's reference: rounded arrow, light inner
// stroke, dark outline). Drawn twice: a wide dark stroke underneath, then the
// filled glyph with a light inner stroke, so it reads on light and dark boards.
const ARROW_PATH = 'M3 2.5 L3 19 L7.3 15.2 L10.2 21.4 L13.2 20 L10.3 13.9 L16 13.6 Z'

function pillLabel(agent: AgentPresence): { text: string; muted: boolean } {
  const name =
    agent.name.length > NAME_MAX_CHARS ? `${agent.name.slice(0, NAME_MAX_CHARS - 1)}…` : agent.name
  if (agent.yielded) {
    return { text: translate('board.agents.youTookOver', 'You took over'), muted: true }
  }
  if (agent.paused) {
    return { text: translate('board.agents.paused', 'Paused'), muted: true }
  }
  if (agent.waiting) {
    return { text: translate('board.agents.waitingForYou', 'Waiting for you'), muted: false }
  }
  if (agent.userState === 'idle') {
    return { text: name.slice(0, 1), muted: false }
  }
  return { text: name, muted: false }
}

export function AgentArrowGlyph({ color }: { color: string }): React.JSX.Element {
  return (
    <svg width="20" height="24" viewBox="0 0 20 24" aria-hidden="true" className="block">
      <path
        d={ARROW_PATH}
        fill="none"
        stroke="var(--agent-outline)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={ARROW_PATH}
        fill={color}
        stroke="var(--agent-outline-inner)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TypingDots(): React.JSX.Element {
  return (
    <span className="ml-1 inline-flex items-center gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          data-agent-dot
          className="inline-block size-[4px] rounded-full bg-current"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  )
}

/** The arrow plus name pill for one agent. Positioned by the layer; renders at (0,0). */
export function AgentCursor({ agent }: { agent: AgentPresence }): React.JSX.Element {
  const label = pillLabel(agent)
  const pillBackground = label.muted ? 'var(--agent-muted)' : agent.color
  const saying = !agent.typing && agent.lastKind === 'say' && agent.text
  return (
    <div
      data-agent-cursor
      data-agent-thinking={agent.thinking ? '' : undefined}
      className="relative"
      style={{
        transform: `translate(${-AGENT_CURSOR_HOTSPOT.x}px, ${-AGENT_CURSOR_HOTSPOT.y}px)`,
        opacity: agent.userState === 'idle' ? 0.5 : 1
      }}
    >
      <AgentArrowGlyph color={agent.color} />
      <div
        className="absolute flex max-w-[240px] flex-col items-start gap-1"
        style={{
          left: AGENT_CURSOR_HOTSPOT.x + PILL_OFFSET.x,
          top: AGENT_CURSOR_HOTSPOT.y + PILL_OFFSET.y
        }}
      >
        <span
          data-agent-pill
          className="inline-flex h-5 items-center rounded-[10px] px-2 text-[12px] leading-none font-semibold whitespace-nowrap"
          style={{ background: pillBackground, color: 'var(--agent-fg)' }}
          title={agent.name}
        >
          {label.text}
          {agent.typing ? <TypingDots /> : null}
        </span>
        {agent.typing && agent.text ? (
          <span
            className="max-w-full truncate rounded-[8px] px-2 py-1 font-mono text-[11px]"
            style={{ background: 'var(--board-panel)', color: 'var(--board-text)' }}
          >
            {agent.text.slice(-24)}
          </span>
        ) : null}
        {saying ? (
          <span
            className="max-w-full rounded-[8px] px-2 py-1 text-[12px]"
            style={{ background: 'var(--board-panel)', color: 'var(--board-text)' }}
          >
            {agent.text}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** Edge-clamped hint for an agent whose pointer is outside the viewport. */
export function AgentEdgeHint({
  agent,
  angleDeg
}: {
  agent: AgentPresence
  angleDeg: number
}): React.JSX.Element {
  return (
    <div data-agent-hint className="flex -translate-x-1/2 -translate-y-1/2 items-center gap-1">
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        aria-hidden="true"
        style={{ transform: `rotate(${angleDeg}deg)` }}
      >
        <path
          d="M2 7 H12 M8 3 L12 7 L8 11"
          fill="none"
          stroke={agent.color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="inline-flex h-5 items-center rounded-[10px] px-2 text-[12px] leading-none font-semibold whitespace-nowrap"
        style={{ background: agent.color, color: 'var(--agent-fg)' }}
      >
        {agent.name}
      </span>
    </div>
  )
}
