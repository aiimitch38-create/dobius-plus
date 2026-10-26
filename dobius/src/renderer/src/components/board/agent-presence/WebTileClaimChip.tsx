// Soft tile claim: a thin top border in the agent's color plus a chip. Three
// states: "Adam is working here" (drops ~3 s after the last action), "Adam is
// waiting for you" after a plain yield (clears at main's `until`), and
// "You took over — resume Adam?" with Resume only after an explicit Take over.
import React, { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { agentControl } from './agent-control-api'
import {
  AGENT_CLAIM_TTL_MS,
  claimActive,
  clearAgentYield,
  useAgentPresence,
  type AgentPresence
} from './agent-presence-state'

type ChipState = 'working' | 'held' | 'takenOver' | null

function chipState(agent: AgentPresence, now: number): ChipState {
  if (!claimActive(agent, now)) {
    return null
  }
  if (agent.yielded) {
    return 'takenOver'
  }
  if (agent.yieldedUntil !== null && agent.yieldedUntil > now) {
    return 'held'
  }
  return 'working'
}

/** Re-renders when the claim TTL or the hold runs out, so the chip clears on time. */
function useChipState(agent: AgentPresence | null): ChipState {
  const [now, setNow] = useState(() => Date.now())
  const lastActionAt = agent?.lastActionAt ?? 0
  const until = agent?.yieldedUntil ?? null
  const agentId = agent?.id ?? null
  useEffect(() => {
    const current = Date.now()
    setNow(current)
    const deadline = until !== null && until > current ? until : lastActionAt + AGENT_CLAIM_TTL_MS
    if (deadline <= current) {
      return
    }
    const timer = window.setTimeout(() => {
      if (agentId && until !== null && until <= Date.now()) {
        clearAgentYield(agentId)
      }
      setNow(Date.now())
    }, deadline - current)
    return () => window.clearTimeout(timer)
  }, [agentId, lastActionAt, until])
  return agent ? chipState(agent, now) : null
}

export function WebTileClaimChip({
  cardId,
  driverAgentId = null
}: {
  cardId: string
  /** Agent id of the console wired to drive this tile; its claim reads "is driving". */
  driverAgentId?: string | null
}): React.JSX.Element | null {
  const agent = useAgentPresence(
    (s) => Object.values(s.agents).find((a) => a.claimedTileId === cardId && !a.stopped) ?? null
  )
  const state = useChipState(agent)
  if (!agent || !state) {
    return null
  }
  const muted = state !== 'working'
  return (
    <>
      <div
        data-agent-claim={agent.id}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
        style={{ background: agent.color }}
      />
      <div
        data-agent-claim-chip={state}
        className="pointer-events-none absolute top-2 right-2 flex h-7 items-center gap-2 rounded-full px-3 text-[12px] font-semibold shadow-(--board-shadow)"
        style={{
          background: muted ? 'var(--agent-muted)' : agent.color,
          color: 'var(--agent-fg)'
        }}
      >
        {state === 'takenOver' ? (
          <>
            {translate('board.agents.tookOverResume', 'You took over — resume {{name}}?', {
              name: agent.name
            })}
            <button
              type="button"
              className="pointer-events-auto h-5 rounded-full px-2 underline underline-offset-2"
              onClick={() => void agentControl({ agentId: agent.id, action: 'resume' })}
            >
              {translate('board.agents.resume', 'Resume')}
            </button>
          </>
        ) : state === 'held' ? (
          translate('board.agents.waitingForYouNamed', '{{name}} is waiting for you', {
            name: agent.name
          })
        ) : driverAgentId !== null && agent.id === driverAgentId ? (
          translate('board.agents.driving', '{{name}} is driving', { name: agent.name })
        ) : (
          translate('board.agents.workingHere', '{{name}} is working here', { name: agent.name })
        )}
      </div>
    </>
  )
}
