# Desktop screen on the phone — plan v2

2026-10-07. Worktree `/Volumes/Storage/dev/dobius`; branch `feat/mobile-desktop-screen`
from foundation commit `33b8a8f4` on `feat/mobile-app`. Source/installed baseline `0fe8eb32`.

| Finding | How v2 resolves it |
| --- | --- |
| 1 | Only production `browser.screencast`/unsubscribe are reused. `binaryOnly` is a fixture, never a production method. |
| 2 | Native window screenshots exist, but not a display-stream API. Display-only benchmark must avoid `getAppState` and Accessibility. |
| 3 | Backend choice requires real 60-second capture metrics, not a guessed polling ceiling. |
| 4 | Capture owner determines permission identity: Electron checks its screen status; native helper checks its own. Remote calls cannot prompt. |
| 5 | Separate desktop binary kind with subscription/generation/display/dimensions, ready ordering and stale rejection; concurrent browser isolation tests. |
| 6 | Registration, classification, allowlist, capability, schemas, typed errors and old/headless fallback are explicit implementation work. |
| 7 | Phase 1 includes named-phone per-session Mac approval, persistent viewing indicator and local Stop fencing auto-reconnect. |
| 8 | Capture/listing require `screen.view`; authenticated owners can always unsubscribe only their own subscription. |
| 9 | Explicit-device grant script, named-device confirmation, dry run and only one grant; existing broad helper untouched. |
| 10 | Screen-specific unsubscribe, late-ready tombstone, early cleanup registration, focus AND foreground requirements. |
| 11 | Subscription foreground lease expires after 30 seconds; generic traffic/pongs never renew it. |
| 12 | One viewer, bounded fps/dimensions/pixels/JPEG size, one capture in flight, newest pending frame and congestion termination. |
| 13 | Ephemeral pixels only, privacy-boundary reference clearing, sentinel logging tests and physical app-switcher inspection. |
| 14 | Existing encryption retained; future input generation, ordered IDs and expiry reject delayed/replayed application commands. |
| 15 | Future control uses atomic acquisition tied to device/connection/generation; agent arbitration and Stop invalidation. |
| 16 | Future provider contract adds global input and coordinate mapping; current window/PID input is insufficient. |
| 17 | Main display only, no picker; comprehensive safety tests plus rendered phone fps/latency and invocation-counter cleanup verification. |
| 18 | Existing image/gesture modules support JS-only phone changes. Stop if any new native receiver/privacy module is needed. |
| 19 | Both navigation files, exact installer argument, packaged registry path, operational prerequisites and approval boundary documented. |

All 19 findings accepted; none rejected. Requirements below are not claims of completed code.

## Phase 0 gate and backend selection

Complete health, save existing files, rewrite plan, benchmark, and commit results
before feature code. Metro initially answered; desktop listened on 6768 and the
refresh LaunchAgent was loaded. Storage briefly disconnected and remounted.
USB detection after remount returned `[]`; physical phone presence remains unverified.
Desktop dependencies were absent; restore with the lockfile through pnpm, never
hand-edit node_modules. Node 24 is the declared desktop toolchain.

**Benchmark A:** Electron `desktopCapturer` thumbnail polling on the main display,
1280 px wide, 3 fps, JPEG q60, 60 seconds. Check
`systemPreferences.getMediaAccessStatus('screen')` before capture, without prompting.
Record first valid frame latency, sustained produced fps, event-loop lag p50/p95/max,
CPU %, peak RSS and encoded bytes/s. Include capture-child CPU if available.
Keep frames in memory and persist aggregate numbers only.

**Benchmark B:** quick display-only native-helper ScreenCaptureKit prototype,
main-display filter, bounded size/frame interval, in-memory JPEG. No Accessibility
tree/window targeting or `getAppState`. Timebox implementation to two hours.
Preflight the actual capture executable's own Screen Recording identity. Record
the same metrics and identify which process's event loop was measured. Standalone
prototype permission does not prove packaged helper permission.

Selection is **pending measurements**. Default to A if lag <50 ms and CPU <25%
at 3 fps; otherwise evaluate B. Denied permission or incomplete runs are blockers,
not performance evidence. Never trigger a permission prompt from an automated
remote/benchmark request. Record results in `plans/DESKTOP-SCREEN-BENCHMARK.md`.
Native independent run completed: 2.080 callback fps, first frame 10007.7 ms,
CPU 3.628%, RSS 104.719 MiB, 387024.6 bytes/s, native main-loop maximum lag
7056.7 ms. It misses the first-frame target; Electron has no valid 60-second
measurement yet. Use the intended Dobius+ permission identity for the remaining
Electron run after Carson enables it; further launch identity experiments are stopped.
Phone-rendered metrics can only follow the approved desktop installation and
are reported separately. Phase 0 commit:
`docs(screen): plan v2 resolving review findings + capture benchmark`.

## Phase 1 implementation steps

Separate commits per numbered step:
`feat(screen): <summary> (DESKTOP-SCREEN v2 step <n>)`, with
`Co-Authored-By: Codex <noreply@openai.com>`. Commit after checks finish successfully.

### Step 1 — contracts, transport and registration

RPCs: `screen.capabilities`, `screen.stream`, `screen.stream.unsubscribe`,
`screen.lease.renew`. Capabilities provides main-display geometry; no picker/list
RPC in Phase 1. Register in `runtime/rpc/methods/index.ts`, add schemas, classify
in `mobile-rpc-method-classes.ts`, allowlist in `runtime-rpc.ts`, grant in
`mobile-rpc-grants.ts`, flag `screen.desktop-view.v1` in `shared/protocol-version.ts`.
Only advertise working graphical capture support. Headless hosts must not import
Electron capture unconditionally; return `screen_unsupported`. Older desktops
without the flag show a desktop-update instruction before screen RPCs are sent.

New `screen.view` is off by default; comment that it exposes everything visible
on the main display, including private messages and passwords. Capabilities,
stream and renew require it. Renew also verifies subscription ownership/generation.
Unsubscribe is authenticated cleanup and verifies BOTH device and connection;
it remains available after grant loss. Cross-phone or second-socket unsubscribe
must fail. Never accept arbitrary IDs through generic runtime cleanup.

Add typed dispatcher errors in `rpc/errors.ts`: `screen_permission_missing`,
`screen_not_authorized`, `screen_unsupported`, `screen_busy`. Grant denial remains
`forbidden`, distinct from Mac consent denial. Capture exceptions are mapped to
safe fixed messages without payload or arbitrary error context.

Reuse encrypted `sendBinary` with a new desktop frame kind, independent of browser
and terminal. Bounded/versioned header: subscription UUID, random generation,
monotonic sequence, display ID, actual JPEG dimensions, format and payload length.
Validate lengths/version/resource bounds before allocation. JSON ready identifies
the same subscription/generation/display and is sent before any frame. Phone only
accepts ready-matched frames with increasing sequence; old generation/other display
and canceled streams are dropped. Never route these bytes to browser callbacks.

### Step 2 — producer, ownership and resource limits

Inject the capture service into runtime without requiring Electron on headless
servers. Electron capture preflights Electron's own screen permission, never the
Computer Use helper status module. Native ownership uses the helper's own check.
Remote requests only check existing permission; prompting is exclusively local.

Atomically reserve at most one active OR pending viewer per Mac before async work.
Owner is authenticated device ID plus connection ID; phone name comes from registry,
not remote params. Per-session desktop approval is required in addition to grant.
No persistent approval or reconnect reuse. Register abort/connection cleanup before
awaiting approval. Check abort, generation, grant, ownership and lease before/after
capture and before ready/send. Drop late results after cancellation.

Lease: 30 seconds, explicitly renewed every 10 seconds by visible foreground route,
with exact subscription/generation. Other RPCs, pongs and subscriptions never renew.
Cleanup on blur/background, socket close, lease expiry, revoke/grant loss, local
Stop, lock/sleep/suspend, capture failure and server shutdown. Graphical Electron
uses powerMonitor lock/suspend events. Cleanup is idempotent, clears pending images,
timers and indicator. Stop invalidates approval and generation synchronously;
pending consent/capture cannot revive it. A new session requires explicit phone
start and fresh Mac approval. No automatic screen subscription replay on reconnect.

Server bounds: fps default 3, min 1, max 10; width 320–1280, height ≤1280, pixels
≤1,638,400, preserve aspect ratio, no upscaling; JPEG q60, bytes ≤1 MiB. Schemas
reject malformed/nonfinite params. One capture in flight, no timer pileup, keep
only newest pending frame. Reject empty/oversized frames. On `sendBinary=false`,
pause capture to avoid filling the channel's 8 MiB queue; bounded retries terminate
after five seconds of sustained congestion. Track non-sensitive invocation/session
counters to prove capture stops. Never log/cache/hash/persist image contents.

### Step 3 — local permission setup, consent, indicator and Stop

Settings → Mobile adds **Enable screen sharing**, explaining main-display scope
and correct capture owner. For Electron this means Dobius+ itself, not Computer Use.
Local setup may invoke the permission-requesting API; phone calls cannot.
Explain restart-required permission state honestly and leave desktop restart to Carson.

Local approval asks **Allow <stored phone name> to view your main screen?** with
Allow/Cancel. Establish a persistent visible Mac banner before the first frame:
**📱 <phone name> is viewing your screen**, with **Stop**. Use a small always-visible
Electron banner/window independent of selected tab or hidden main window. Local
IPC handles approval/Stop; no phone approve RPC. Stop fences the session before UI
teardown. Use `dobius/docs/STYLEGUIDE.md` tokens and existing primitives.

### Step 4 — precise grant script and instructions

Add `scripts/grant-mobile-permission.sh <deviceId> <grant> [--dry-run]`.
Require exact device ID/mobile scope and supported grant (`screen.view` in Phase 1).
Display stored phone name and requested grant; dry run never writes. Mutation
requires confirmation of the named device. Require packaged Dobius+ closed before
reading and again before atomic write; never quit/reopen it from the script.
Validate schema, preserve all other devices/grants/unknown fields, add only the
requested grant idempotently, preserve secure permissions. Credential backups
must be private and never staged/logged. Packaged registry defaults to
`~/Library/Application Support/dobius-plus/dobius-devices.json`; dev userData override
requires explicit documented path, never guess the latest phone. Leave
`/Volumes/Storage/dev/grant-terminal-send.sh` untouched.

Future `screen.control` effectively permits arbitrary Mac actions, including
opening a terminal; withholding `terminal.send` does not constrain it. No control
grant or code in Phase 1.

### Step 5 — phone foreground viewer (JS only)

Route `mobile/app/h/[hostId]/desktop.tsx`; navigation in both
`mobile/app/h/[hostId]/index.tsx` and Quick Actions `mobile/app/index.tsx`.
Use React Native Image and existing Gesture Handler/Reanimated for pinch/pan.
No native dependency, Pods, prebuild or phone reinstall. Stop/report if a needed
privacy or receiver feature requires a native module.

Screen binary routing and screen-specific unsubscribe in `rpc-client.ts`.
Cancel-before-ready keeps bounded tombstone; late ready unsubscribes immediately.
Dead-connection tombstones clear on close. Never automatically replay desktop
subscriptions; reconnect blanks pixels and requires explicit start/new approval.
Stop stays Stopped until explicit start.

Viewing requires route focus AND active AppState. Blur/background synchronously
clear image, pending render, gesture state and renew timer, then unsubscribe.
Clear every image reference on Stop, revoke/error and host change. Current-frame
in-memory data URI only: no file cache, AsyncStorage, RPC JSON, telemetry or exception
context. Physical app-switcher snapshot privacy must be observed; report any shell
limitation requiring native protection before adding a dependency.

Badges: Live only after image onLoad; Paused for local inactivity; Reconnecting for
disconnected transport with blank pixels; Stopped for local session termination.
Plain errors point to implemented local setup, per-session approval, precise grant
script or desktop update. Disconnected means “Can't reach your Mac”, never inferred
sleep. Log only bounded metadata (start time, loaded-image count, elapsed time) for
rendered fps/latency, never frame/data URI/request objects.

### Step 6 — safety tests, build and human installation gate

Required tests: grants/classification/registration; mismatched TCC identities and
no remote prompts; typed error through real dispatcher and phone client; concurrent
browser/desktop isolation and stale generations; cancel-before-ready; Stop fencing
approval and delayed capture; lease expiry despite pongs/generic traffic; revoke
mid-stream; one viewer/capture and caps/backpressure; cross-phone/second-socket
unsubscribe; shutdown/sleep; sentinel payload exclusion from console, diagnostics,
telemetry and RPC JSON; old/headless-host fallback; focus/foreground reference cleanup.
Use injectable clock/capture/send functions and active-session/invocation assertions.

Mobile: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, each exit 0 in
`dobius/mobile`. Desktop: `pnpm run typecheck`, `pnpm test` from its package scripts
and focused safety tests. Read owning vitest configs, never invent tsconfig paths.
Await real exit codes; no overlapping heavy builds. Check existing builder processes.

Repo-root build: `pnpm --dir dobius run build:unpack`. Verify actual artifact and
executable spawn-helper mode. STOP before installing. Exact human command:
`scripts/install-dobius-gated.sh dobius/dist/mac-arm64/Dobius+.app`.
No push, main changes, secrets, bypassed hooks, installed-app restart/install,
generated iOS/node_modules edits or pixel persistence/logging.

## Physical-device acceptance after Carson installs

1. Regenerate pairing in Mac Settings → Mobile; re-pair with a fresh code because
   the old link was exposed in a chat log.
2. Approve/run gated desktop installation (one Dobius+ restart).
3. Use Enable screen sharing and allow Screen Recording for the actual owner.
4. With Dobius+ closed, dry-run/run explicit-device `screen.view` grant, confirm
   phone name, then reopen Dobius+.
5. Restart Metro and prebuild iOS Hermes bundle with the handoff URL. Automatic
   Metro recovery is separate; keep `http://100.94.52.53:8081`. Open Desktop and
   approve the named phone on the Mac.
6. Verify first rendered frame <3 s, rendered fps ≥2 for 60 seconds over Tailscale
   using metadata in metro.log; separately test cold startup and load.
7. Mac Stop blanks phone pixels and prevents automatic resume.
8. Background/blur stops capture: invocation counter stops advancing and no active
   session remains. Physically inspect app-switcher snapshot privacy.

Until human steps run, physical screen acceptance is unverified. Metro IP, installed
phone bundle, historical memory pressure and teammate coordination are operational
prerequisites, not source proof. Same failure twice → record date/Tried/Failed because/
Works instead in LESSONS-LEARNED.md and proceed with independent work.

## Phase 2 notes only (do not build)

Extend native provider contract for global input: current input is window/PID scoped.
Define logical desktop points vs captured pixels, Retina scale, display origins
(including negative), current geometry/focus, Dock/menu bar, zoom/letterboxing,
double/right click and key chords. Atomic acquire/release/renew binds authenticated
device/connection/viewing relationship/generation; reject competing controllers and
arbitrate with agent input. Ordered input IDs and execution-time expiry reject
duplicate/delayed actions. Never queue/replay input across reconnect. Stop invalidates
lease and queued actions before next native action. Ciphertext replay protection is
separate from application input order. Multi-monitor/mixed-DPI selection is Phase 3.
