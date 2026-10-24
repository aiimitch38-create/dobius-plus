// Best-effort still of a web tile's page, shown as its zoomed-out miniature.

/** The slice of Electron's NativeImage this needs (kept structural for tests). */
export type ThumbnailImage = {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width: number }): ThumbnailImage
  toDataURL(): string
}
export type CapturableGuest = { capturePage(): Promise<ThumbnailImage> }

/** Wider stills are downscaled: the miniature is only ever drawn smaller than 1:1. */
export const WEB_THUMBNAIL_MAX_WIDTH = 960
/** How often an on-screen miniature re-captures, so a reloading dev server stays current. */
export const WEB_THUMBNAIL_REFRESH_MS = 10_000

/**
 * A data URL of the guest's current frame, or null when there is nothing
 * usable (guest not attached yet, compositor gave an empty frame, guest gone).
 * Callers keep the previous still on null rather than blanking the tile.
 */
export async function captureWebTileThumbnail(
  guest: Partial<CapturableGuest> | null
): Promise<string | null> {
  if (!guest || typeof guest.capturePage !== 'function') {
    return null
  }
  try {
    const image = await guest.capturePage()
    if (!image || image.isEmpty()) {
      return null
    }
    const { width } = image.getSize()
    const scaled =
      width > WEB_THUMBNAIL_MAX_WIDTH ? image.resize({ width: WEB_THUMBNAIL_MAX_WIDTH }) : image
    return scaled.toDataURL()
  } catch (error) {
    // Not attached / destroyed mid-capture: the tile keeps its previous still.
    console.debug('[board-web] thumbnail capture skipped', error)
    return null
  }
}
