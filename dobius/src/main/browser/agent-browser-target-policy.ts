import { session, type WebContents } from 'electron'
import { DOBIUS_WEB_TILE_PAGE_ID_PREFIX, DOBIUS_WEB_TILE_PARTITION } from '../../shared/constants'
import { BrowserError } from './cdp-bridge'

export type AgentTargetGuest = {
  /** Board card id the guest belongs to (browserPageId minus the `web-tile:` prefix). */
  tileId: string
}

export function webTileIdFromBrowserPageId(browserPageId: string): string | null {
  if (!browserPageId.startsWith(DOBIUS_WEB_TILE_PAGE_ID_PREFIX)) {
    return null
  }
  const tileId = browserPageId.slice(DOBIUS_WEB_TILE_PAGE_ID_PREFIX.length)
  return tileId.length > 0 ? tileId : null
}

/**
 * Agent-identified commands may only drive Board web tiles whose guest runs in
 * the private, in-memory web-tile session. A tile the user switched to the
 * signed-in (shared) session is off limits: the agent would act with the
 * user's logins. The check reads the guest's real `webContents.session` in
 * main; a renderer-supplied partition id is never trusted.
 */
export function assertAgentMayTargetGuest(
  agentName: string,
  browserPageId: string,
  guest: WebContents
): AgentTargetGuest {
  const tileId = webTileIdFromBrowserPageId(browserPageId)
  if (!tileId) {
    throw new BrowserError(
      'agent_target_forbidden',
      `${agentName} may only drive Board web tiles (page ids starting with "${DOBIUS_WEB_TILE_PAGE_ID_PREFIX}"); ` +
        `${browserPageId} is a regular browser tab. Open a web tile with \`dobius board open-tile\` and pass --page web-tile:<cardId>.`
    )
  }
  if (guest.session !== session.fromPartition(DOBIUS_WEB_TILE_PARTITION)) {
    throw new BrowserError(
      'agent_target_forbidden',
      `${agentName} may not drive ${browserPageId}: its page runs outside the private web-tile session ` +
        '(the tile is set to the shared, signed-in session). Switch the tile back to "private" and retry.'
    )
  }
  return { tileId }
}
