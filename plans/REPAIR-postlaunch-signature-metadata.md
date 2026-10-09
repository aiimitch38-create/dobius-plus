# Repair: post-launch signature metadata mutation

## Diagnosis

The pre-install packaged app passed strict code-signature verification. After installation and launch, the installed `.app` root acquired a 32-byte `com.apple.FinderInfo` attribute and strict verification failed. The saved `appIcon=blue` setting was present before installation. In `dobius/src/main/app-icon.ts`, applying an icon updates Electron's live Dock/window icons and also queues AppleScript that calls `NSWorkspace.setIcon:forFile:` on the signed app bundle. Switching back to classic similarly calls `NSWorkspace.setIcon` and deletes FinderInfo/ResourceFork with `xattr`. This is the concrete source path capable of mutating signed bundle metadata; payload-copy damage is not supported by the available evidence.

## Plan

- Remove post-signing app-bundle icon metadata writes and cleanup commands from the app-icon module.
- Preserve runtime `app.dock.setIcon` and `BrowserWindow.setIcon`, plus saved icon selection and asset lookup.
- Replace persistence-queue tests with focused tests for path selection and live icon application, including destroyed windows and empty images.
- Record the signing constraint in `dobius/LESSONS-LEARNED.md`.
- Verify with the focused app-icon test, the supported Node typecheck, and `git diff --check`; inspect the final diff for any bundle path, `NSWorkspace`, or `xattr` mutation remaining.

## Files

- `dobius/src/main/app-icon.ts`
- `dobius/src/main/app-icon.test.ts`
- `dobius/LESSONS-LEARNED.md`
- `plans/REPAIR-postlaunch-signature-metadata.md`

## Regression and acceptance

The focused test must prove custom icon selection still changes the live Dock icon on macOS and updates non-destroyed windows. Source review must establish that applying an icon cannot write metadata to the signed app bundle. The installed bundle and physical codesign state are deliberately not modified or re-tested in this source-only task.

## Rollback

Revert this isolated repair commit to restore the prior icon metadata persistence behavior. Do not repair a deployed bundle by editing attributes or re-signing it as part of this change.
