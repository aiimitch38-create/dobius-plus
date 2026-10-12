# View your Mac on your phone

This feature changes only phone JavaScript; no phone reinstall is needed.
Desktop screen viewing requires the new desktop build. It shares the main display,
including private messages and passwords, with one approved phone at a time.

1. In desktop Settings → Mobile, regenerate the pairing code and re-pair your phone.
   The old pairing link was exposed in a chat log.
2. After approving the desktop install, run from the external worktree:
   `scripts/install-dobius-gated.sh dobius/dist/mac-arm64/Dobius+.app`.
3. In Settings → Mobile, click **Enable screen sharing**. Allow Screen Recording
   for **Dobius+ Computer Use**. Accessibility is not needed for viewing.
   If macOS requires a restart, quit/reopen Dobius+ yourself.
4. Copy the exact paired phone device ID from Settings → Mobile. Close Dobius+
   yourself, then run `scripts/grant-mobile-permission.sh <deviceId> screen.view --dry-run`.
   Check the phone name. Run again without `--dry-run`, type that same ID to confirm,
   and reopen Dobius+. This adds only `screen.view`; it preserves existing grants.
   Development registries require `--registry <absolute path>`; the default is
   `~/Library/Application Support/dobius-plus/dobius-devices.json`.
5. Open **Desktop** on the host screen or in Quick Actions and tap **View my screen**.
   Approve the named phone on the Mac. Pinch to zoom and drag to pan.

The Mac shows “📱 <phone name> is viewing your screen” and **Stop** throughout viewing.
Stop, backgrounding the phone, leaving the screen, disconnecting, locking/sleeping,
revoking access, lease expiry, congestion, or hiding Dobius+ ends capture.
Pixels are cleared; returning or reconnecting requires a new explicit start and approval.
Frames stay in memory. Phase 1 has no saving or input control.

`screen.control` is future work and would permit essentially arbitrary Mac actions;
withholding terminal permission would not constrain it. “Save screenshot” is also
future work: an explicit tap would save to Photos and require photo-library-add
native configuration plus one phone rebuild/reinstall.
