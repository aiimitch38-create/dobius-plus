// Viewports the web tile can simulate. CSS pixel sizes (portrait for phones).
export type WebTileDevice = {
  id: string
  label: string
  width: number
  height: number
  mobile: boolean
}

export const WEB_TILE_DEVICES: readonly WebTileDevice[] = [
  { id: 'monitor-24', label: '24″ monitor', width: 1920, height: 1080, mobile: false },
  { id: 'monitor-27', label: '27″ monitor', width: 2560, height: 1440, mobile: false },
  { id: 'monitor-32', label: '32″ monitor', width: 3840, height: 2160, mobile: false },
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, mobile: true },
  { id: 'iphone-14-pro', label: 'iPhone 14 Pro', width: 393, height: 852, mobile: true },
  { id: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max', width: 430, height: 932, mobile: true },
  { id: 'pixel-7', label: 'Pixel 7', width: 412, height: 915, mobile: true },
  { id: 'galaxy-s8-plus', label: 'Galaxy S8+', width: 360, height: 740, mobile: true }
]

export function findWebTileDevice(id: string | null | undefined): WebTileDevice | null {
  return WEB_TILE_DEVICES.find((d) => d.id === id) ?? null
}

/** Scale that fits the device inside the tile body without upscaling past 1. */
export function deviceFitScale(
  device: WebTileDevice,
  box: { width: number; height: number }
): number {
  if (box.width <= 0 || box.height <= 0) {
    return 1
  }
  return Math.min(1, box.width / device.width, box.height / device.height)
}

/**
 * The browser's own user agent dressed as a phone: keeps the real engine and
 * version, adds the "Mobile" token sites look for. Idempotent.
 */
export function mobileUserAgent(base: string): string {
  if (/\bMobile\b/.test(base)) {
    return base
  }
  const withPlatform = base.replace(/\([^)]*\)/, '(Linux; Android 14; Pixel 7)')
  return withPlatform.replace(/(Safari\/[\d.]+)/, 'Mobile $1')
}
