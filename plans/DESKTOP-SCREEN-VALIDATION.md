# Desktop screen Phase 1 validation — 2026-10-07

Branch: `feat/mobile-desktop-screen`. Native capture backend selected in
`DESKTOP-SCREEN-BENCHMARK.md`; Electron's final bounded attempt timed out.

## Automated evidence

- Mobile `pnpm test --maxWorkers=1`: exit 0, 175 files, 1,254 passed, two skipped.
  Serial workers avoid the baseline parallel worker startup timeout.
- Three existing GitHub fixture expectations used `dobius-plus` while their input
  repository was `dobius`. Corrected those expectations; no matching behavior changed.
- Mobile `pnpm exec tsc --noEmit` and `pnpm lint`: both exit 0.
- Desktop `pnpm run typecheck`: exit 0 (node, CLI and web configurations).
  Package `pnpm test --maxWorkers=1` with the protocol, RPC contract and
  session-service test paths: exit 0, 18 safety tests after the final extraction.
  Scoped desktop capture/RPC lint: exit 0. Artifact checks are recorded
  in `/Volumes/Storage/dev/codex-runs/screen-status.md` with actual exit codes.
- Real phone RPC-client tests exercise simultaneous browser/desktop binary routing,
  pending request cancellation, late-ready cleanup and disconnect without replay.
- Controller tests exercise older-host fallback, foreground renewal/cleanup,
  rendered-image counters and exclusion of sentinel pixels from logs.
- Grant helper: five fixture tests passed; running-app guard refused an actual
  invocation. No real device grants were changed.
- Swift 6 standalone typecheck passed for the display-only native producer.

Native capture keeps one encoder, one newest pending pixel buffer and one latest
JPEG in memory. Delivery has a separate bounded-rate writer; idle samples keep a
static display live without repeated encoding. Blank/suspended/stopped content,
permission loss or five seconds of capture silence exits without reusing pixels.
The parent closes all image pipes and fences the session before stopping the helper.
This replaces the benchmark's main-queue/per-frame work; it is an implementation
change, not evidence that first-frame or lag performance targets are met.

## Human acceptance still required

No desktop installation, installed-app restart, push or phone native change was
performed. The physical phone is absent from USB discovery. After Carson installs
the built desktop, refreshes pairing, enables the actual helper's Screen Recording
permission and grants his exact phone `screen.view`, verify on Tailscale:

1. First rendered frame under three seconds after ready, at least two rendered
   frames per second over 60 seconds, including static content and cold startup.
2. Mac Stop clears phone pixels and reconnect cannot restart capture.
3. Background/route blur stops capture; inspect invocation counters and the iOS
   app-switcher snapshot. JavaScript reference clearing is covered automatically;
   native snapshot behavior requires a physical-device check.
4. Confirm the named-phone indicator remains visible during full-screen use,
   hide/lock/sleep stop capture and the setup action prompts only on local tap.

Carson's sequence and exact commands are in `dobius/mobile/docs/DESKTOP-SCREEN.md`.
Photo saving is follow-up only and requires a future phone native rebuild.
