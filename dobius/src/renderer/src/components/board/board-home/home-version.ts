// Version shown in the Home footer.
//
// Why: the main process answers with app.getVersion(), which is Electron's
// own version when the app runs unpackaged (QA saw "v42.4.1" on a 2.0.10
// copy). The build stamps package.json's version into the renderer; prefer it.

/** The version the footer shows, or null to hide it. */
export function homeVersionLabel(
  buildVersion: string | undefined | null,
  runtimeVersion: string | null,
  electronVersion: string | null
): string | null {
  const stamped = buildVersion?.trim()
  if (stamped) {
    return stamped
  }
  const runtime = runtimeVersion?.trim()
  if (!runtime) {
    return null
  }
  // Electron's own version is never the app's; hide it rather than mislead.
  return electronVersion && runtime === electronVersion ? null : runtime
}

/** Electron's version from the user agent ("… Electron/42.4.1 …"), or null. */
export function electronVersionFromUserAgent(userAgent: string): string | null {
  return /Electron\/(\d+(?:\.\d+)*)/.exec(userAgent)?.[1] ?? null
}
