// "Human always wins": when Carson touches a tile an agent claims, main holds
// the agent for a while (`until`, renewed on each yield). The host never sees
// clicks inside the guest, so the two host-side signals are the webview's focus
// event and a pointer on the tile chrome; main renews from real guest input.
import { agentYield } from './agent-control-api'
import { claimantOfTile, markTileYield } from './agent-presence-state'

export const WEB_TILE_YIELD_THROTTLE_MS = 2_000

export type WebTileYieldDeps = {
  isClaimed: (cardId: string) => boolean
  yieldTile: (cardId: string) => Promise<void> | void
  now: () => number
}

const defaultDeps: WebTileYieldDeps = {
  isClaimed: (cardId) => claimantOfTile(cardId) !== null,
  yieldTile: async (cardId) => {
    const result = await agentYield(cardId)
    if (result) {
      markTileYield(cardId, result.until)
    }
  },
  now: () => Date.now()
}

export function attachWebTileYield(
  cardId: string,
  webview: HTMLElement,
  chrome: HTMLElement | null,
  deps: WebTileYieldDeps = defaultDeps
): () => void {
  let lastAt = Number.NEGATIVE_INFINITY
  const report = (): void => {
    if (!deps.isClaimed(cardId)) {
      return
    }
    const at = deps.now()
    if (at - lastAt < WEB_TILE_YIELD_THROTTLE_MS) {
      return
    }
    lastAt = at
    void deps.yieldTile(cardId)
  }
  webview.addEventListener('focus', report)
  chrome?.addEventListener('pointerdown', report, true)
  return () => {
    webview.removeEventListener('focus', report)
    chrome?.removeEventListener('pointerdown', report, true)
  }
}
