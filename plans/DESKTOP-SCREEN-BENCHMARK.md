# Desktop capture benchmark — pending permission/runtime prerequisite

2026-10-07, this Mac. Required run: main display, 1280 px wide, 3 fps,
JPEG quality approximately 60, 60 seconds. No frames were logged or persisted.

| Backend | Actual result | Performance metrics |
| --- | --- | --- |
| A: Electron 42.3.3 thumbnail polling | Startup repaired with a local development signature on the isolated benchmark app. Bounded preflight reached code and returned `getMediaAccessStatus('screen') = denied`, exit 2. | Unavailable; no valid first frame or 60-second run. |
| B: native display-only ScreenCaptureKit prototype | Compiled with Xcode Swift in Swift 5 mode. Own `CGPreflightScreenCaptureAccess()` returned false; process exited 2 with `permission=not_granted` without requesting permission or capturing. | Unavailable; permission denied is not a throughput measurement. |

Backend choice is **blocked**, not inferred. No performance threshold has been
verified and Phase 1 feature implementation has not started. The plan requires
successful measurements before selecting the backend.

Electron source: `dobius/tools/benchmarks/desktop-screen-capture.cjs`.
Native source/executable: `/Volumes/Storage/dev/codex-runs/screen-capture-prototype.swift`
and `/Volumes/Storage/dev/codex-runs/screen-capture-prototype`.
Native prototype uses main-display SCContentFilter and JPEG encoding in memory;
it does not use `getAppState`, Accessibility, window capture or disk images.
Swift compile produced concurrency warnings about NSLock in async context under
Swift 5; this measurement prototype is not shipping helper implementation.

User prerequisite for native measurement: enable Screen & System Audio Recording
for the prototype executable in macOS privacy settings. Capture remains gated on
its own permission check. This does not authorize the packaged Dobius+ identity.
Electron startup diagnosis: cached archive lacked `_CodeSignature/CodeResources`
while its executable signature required sealed resources. Both `codesign --verify`
and `spctl --assess` failed with “code has no resources but signature indicates
they must be present.” Normal LaunchServices launch failed with `-10810`; raw
launch under a 60-second Perl alarm exited 142 without benchmark output.
`codesign --force --deep --sign -` on the isolated benchmark copy exited 0.
The subsequent 60-second bounded preflight logged Electron 42.3.3 bootstrap,
reported `permission=denied`, and exited 2. This resolves startup sufficiently
to check the correct Electron capture identity. Subsequent deep/strict signature
verification exited 0: “valid on disk” and “satisfies its Designated Requirement.”
No installed Dobius+ bundle was modified, restarted or installed.

Both capture identities still need macOS permission before any throughput run.
Carson should enable the repaired `screen-benchmark-electron/Electron.app` and
the native prototype in Screen & System Audio Recording, then notify Codex.
Do not repeatedly rerun a denied preflight or silently request permission.

Separate physical phone acceptance remains unverified and requires the later
approved desktop installation, new pairing, screen grant and local setup.

Operational recovery now verified: `curl --max-time 8 -fsS
http://100.94.52.53:8081/status` returned `packager-status:running`. Five supervisor
tests and focused oxlint passed. Real unplug/remount recovery has not been
intentionally tested. USB phone detection returned `[]`; desktop listens on 6768.
