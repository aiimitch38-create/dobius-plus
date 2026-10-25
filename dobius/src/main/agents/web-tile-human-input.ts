// Human input inside a web tile goes straight to the guest, so the renderer never
// sees it. Main listens on the guest webContents and renews the tile's yield
// (AGENT-CURSORS-RESEARCH §5.3 "human always wins") while Carson keeps typing
// or clicking. Input the agent itself injects over CDP is ignored: the browser
// bridge brackets each dispatch with `registry.markAgentDispatch(tileId)`.
import type { WebContents } from 'electron'
import { DOBIUS_WEB_TILE_PAGE_ID_PREFIX } from '../../shared/constants'
import { isWebTileBrowserPageId } from '../../shared/board-web-tile-popup'
import { agentPresenceRegistry, type AgentPresenceRegistry } from './agent-presence-registry'

export const HUMAN_INPUT_YIELD_THROTTLE_MS = 1_000

// Why: hovering over a tile is not "working in it"; only presses, keys and wheel count.
const IGNORED_INPUT_TYPES: ReadonlySet<string> = new Set(['mouseMove', 'mouseEnter', 'mouseLeave'])

export function webTileIdFromBrowserPageId(browserPageId: string): string | null {
  return isWebTileBrowserPageId(browserPageId)
    ? browserPageId.slice(DOBIUS_WEB_TILE_PAGE_ID_PREFIX.length)
    : null
}

/**
 * Attaches the listeners for one web tile guest; returns the detach function.
 * No-op (returns a noop) for non web-tile page ids.
 */
export function attachWebTileHumanInput(
  guest: WebContents,
  browserPageId: string,
  registry: AgentPresenceRegistry = agentPresenceRegistry,
  now: () => number = Date.now
): () => void {
  const tileId = webTileIdFromBrowserPageId(browserPageId)
  if (!tileId) {
    return () => undefined
  }
  let lastYieldAt = Number.NEGATIVE_INFINITY
  const noteHumanInput = (): void => {
    if (registry.isAgentDispatching(tileId)) {
      return
    }
    const at = now()
    if (at - lastYieldAt < HUMAN_INPUT_YIELD_THROTTLE_MS) {
      return
    }
    lastYieldAt = at
    registry.yieldTile(tileId)
  }
  const onKey = (): void => noteHumanInput()
  const onInput = (_event: Electron.Event, input: Electron.InputEvent): void => {
    if (!IGNORED_INPUT_TYPES.has(input.type)) {
      noteHumanInput()
    }
  }
  guest.on('before-input-event', onKey)
  guest.on('input-event', onInput)
  return () => {
    guest.off('before-input-event', onKey)
    guest.off('input-event', onInput)
  }
}
