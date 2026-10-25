import { DOBIUS_WEB_TILE_PAGE_ID_PREFIX } from './constants'

/** Main → Board renderer: a web tile's page asked for a new window (`ui:boardWebTilePopup`). */
export type BoardWebTilePopupEvent = {
  /** The tile's guest; the renderer matches it against each tile's webContentsId. */
  guestWebContentsId: number
  /** http(s) URL, or '' for about:blank (the sibling tile opens empty). */
  url: string
  disposition: string
}

/** Popups one tile guest may open per window; beyond that they are dropped (popup storms). */
export const WEB_TILE_POPUP_BUCKET_MAX = 3
export const WEB_TILE_POPUP_BUCKET_WINDOW_MS = 10_000
/** Popup-derived sibling tiles one source tile may have on the board at once. */
export const WEB_TILE_POPUP_SIBLING_CAP = 5

/**
 * Token bucket on recent popup timestamps: prunes entries older than the
 * window and tells whether one more popup fits. Mutates `recent`.
 */
export function takeWebTilePopupToken(recent: number[], now: number): boolean {
  const cutoff = now - WEB_TILE_POPUP_BUCKET_WINDOW_MS
  while (recent.length > 0 && recent[0] <= cutoff) {
    recent.shift()
  }
  if (recent.length >= WEB_TILE_POPUP_BUCKET_MAX) {
    return false
  }
  recent.push(now)
  return true
}

export function isWebTileBrowserPageId(browserPageId: string | null | undefined): boolean {
  return typeof browserPageId === 'string' && browserPageId.startsWith(DOBIUS_WEB_TILE_PAGE_ID_PREFIX)
}

export function webTileBrowserPageId(cardId: string): string {
  return `${DOBIUS_WEB_TILE_PAGE_ID_PREFIX}${cardId}`
}

/**
 * The URL a popup may open in a sibling tile: http(s) as parsed, about:blank
 * (and an empty URL) as ''. javascript:, file:, data: and custom schemes are
 * null — the popup is dropped.
 */
export function webTilePopupUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0 || trimmed === 'about:blank') {
    return ''
  }
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}
