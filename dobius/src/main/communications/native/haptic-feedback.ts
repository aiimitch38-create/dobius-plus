// Communications command: perform_sidebar_default_haptic
//
// DELIBERATE NO-OP — not merely unimplemented. macOS trackpad haptics are
// driven by NSHapticFeedbackManager, a private-frameworks-adjacent AppKit
// API. Electron exposes no binding for it (no `nativeTheme`/`app` method,
// no BrowserWindow method); there is no supported way to trigger a trackpad
// tick from a BrowserWindow's main process. This mirrors the documented
// `set_prevent_sleep_active` no-op precedent in dobiusCommunications.ts: the
// call is honored (never throws) but performs no physical feedback.
//
// The vendor call site (shared/lib/haptics.ts) already treats this as
// fire-and-forget (`void invoke(...).catch(() => {})`), so returning a
// structured "not performed" result here costs nothing but keeps this module
// honest for anything that does inspect the result (e.g. these tests).

export type HapticFeedbackResult = {
  performed: false
  reason: 'not_supported_by_electron'
}

export function performSidebarDefaultHaptic(): HapticFeedbackResult {
  return { performed: false, reason: 'not_supported_by_electron' }
}
