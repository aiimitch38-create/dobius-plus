// Whether a web tile must stay live (no glance still) because an agent is
// working in it. Re-evaluates on store changes and once the activity window
// lapses, so the tile returns to its normal glance when the agent goes idle.
import { useEffect, useState } from 'react'
import { AGENT_TILE_LIVE_MS, agentLiveOnTile, useAgentPresence } from './agent-presence-state'

export function useAgentTileLive(cardId: string): boolean {
  const [live, setLive] = useState(() => agentLiveOnTile(cardId))
  useEffect(() => {
    let timer: number | undefined
    const update = (): void => {
      window.clearTimeout(timer)
      const next = agentLiveOnTile(cardId)
      setLive(next)
      if (next) {
        // Why: nothing in the store changes when the window lapses, so re-check then.
        timer = window.setTimeout(update, AGENT_TILE_LIVE_MS)
      }
    }
    update()
    const unsubscribe = useAgentPresence.subscribe(update)
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [cardId])
  return live
}
