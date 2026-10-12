export const DESKTOP_SCREEN_ERRORS = {
  screen_permission_missing:
    'Enable Screen Recording for the desktop screen capture helper on your Mac.',
  screen_not_authorized: 'Start viewing again and approve this phone on your Mac.',
  screen_unsupported: 'Desktop screen viewing is unavailable on this host.',
  screen_busy: 'Another phone is already requesting or viewing this screen.'
} as const
export type DesktopScreenErrorCode = keyof typeof DESKTOP_SCREEN_ERRORS

// Fixed messages exclude arbitrary native errors or frame-bearing objects.
export class DesktopScreenError extends Error {
  constructor(readonly code: DesktopScreenErrorCode) {
    super(DESKTOP_SCREEN_ERRORS[code])
    this.name = 'DesktopScreenError'
  }
}
