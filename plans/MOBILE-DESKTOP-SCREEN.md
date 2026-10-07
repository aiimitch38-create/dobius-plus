# Build Plan — See and control the Mac desktop from the Dobius phone app

Branch: new branch `feat/mobile-desktop-screen` from `feat/mobile-app` (which points at `stabilize/integration` @ 0fe8eb32, the code the installed desktop runs). Worktree: `/Volumes/Storage/dev/dobius`.
Executor: Codex, with Claude reviewing. Written 2026-10-07.

## Goal
A **Desktop** screen in the phone app that shows the paired Mac's screen live, and, in phase 2, lets Carson tap to click and type into it. It works over the existing encrypted phone↔desktop connection (Tailscale), behind new per-phone permissions that are **off by default**.

## Why this is buildable now (verified in code, 2026-10-07)
- **Phone streaming already exists for the in-app browser**: desktop `src/main/browser/browser-screencast-stream.ts`; phone `mobile/src/transport/browser-screencast-protocol.ts` (frames are `jpeg | png`) and `mobile/src/browser/MobileBrowserPane.tsx`; RPC methods `browser.screencast`, `browser.screencast.binaryOnly`, `browser.screencast.unsubscribe`. Reuse this pattern and its binary-frame path, not a new transport.
- **Mac control already exists for agents**: `src/main/computer/` (native macOS provider: `macos-native-provider-client.ts`, `macos-native-provider-contract.ts`; permission checks: `macos-computer-use-permissions.ts`, `macos-computer-use-permission-status.ts`).
- **The per-phone permission system exists**: `src/main/runtime/mobile-rpc-grants.ts` (`MOBILE_RPC_GRANTS`, method → grant requirements). Grants live in `dobius-devices.json` and are read at startup.
- **Not present yet**: whole-screen capture. No `desktopCapturer` use in `src/main`.

## Phase 1 — View only (ship first)
**Desktop**
1. `src/main/screen/desktop-screen-stream.ts`: capture the main display with Electron `desktopCapturer.getSources({ types: ['screen'], thumbnailSize })`, encode JPEG (quality ~60), at a target of 3 fps, scaled to the phone's requested width (default 1280 px). Send frames through the same binary-frame mechanism `browser-screencast-stream.ts` uses.
   - `// ponytail:` polling thumbnails tops out around 5–10 fps with noticeable CPU. Upgrade to ScreenCaptureKit/WebRTC only if that proves too slow.
2. RPC methods: `screen.displays` (list displays and sizes), `screen.stream` (subscribe: displayId, maxWidth, fps), `screen.stream.unsubscribe`. Streams stop when the socket closes (reuse the connection-cleanup hooks in `runtime-rpc.ts`) and after 10 minutes without a phone heartbeat.
3. New grant `screen.view` in `MOBILE_RPC_GRANTS`, with a comment: "Watching the whole desktop, including anything on screen such as messages and passwords." Map the three methods to it. Add the methods to the mobile allowlist.
4. macOS **Screen Recording** permission: detect it (reuse the pattern in `macos-computer-use-permission-status.ts`). If it's missing, return a typed error `screen_permission_missing` with plain-English steps. Never auto-prompt from a phone request; the prompt happens on the desktop.

**Phone**
5. A new route, `mobile/app/h/[hostId]/desktop.tsx`, plus a "Desktop" entry on the host screen and in Quick Actions. Live image with pinch-zoom and pan (react-native-gesture-handler / reanimated, already installed). Display picker. A "Live" / "Paused" / "Reconnecting" badge. Pause the stream when the app goes to the background.
6. Error states in plain English: permission not granted on the phone ("Turn on 'Watch desktop' for this phone on your Mac"), Screen Recording off on the Mac, desktop asleep, connection lost.

**Acceptance (Phase 1)**
- Phone shows the Mac screen updating at ≥2 fps over Tailscale. First frame arrives in under 3 s.
- Without `screen.view`, the methods return `forbidden` and the phone shows the friendly message.
- Closing the screen or backgrounding the app stops capture (verified by desktop CPU dropping or a stream-count log).
- Unit tests: grant mapping, stream lifecycle/cleanup, frame-size clamping. Existing mobile and desktop tests stay green.

## Phase 2 — Tap and type
7. RPC `screen.input` with `{ type: 'click' | 'doubleClick' | 'rightClick' | 'scroll' | 'key' | 'text', x, y, ... }`, with coordinates normalized to the display (0–1) and mapped to real pixels on the desktop. Execute through the existing native macOS provider in `src/main/computer/`. Read `macos-native-provider-contract.ts` first; don't add a second input path.
8. New grant `screen.control` (separate from `screen.view`), with a comment: "Clicking and typing anywhere on the Mac as Carson." It requires Accessibility permission on the Mac (reuse `macos-computer-use-permissions.ts`).
9. Phone: tap = click, long-press = right-click, two-finger drag = scroll, keyboard button opens the iOS keyboard and sends `text`, plus a small key bar (Esc, Tab, ⌘, arrows). A visible "Controlling your Mac" banner while control is on.
10. Safety: at most one phone controls at a time. While control is active, the desktop shows an on-screen indicator ("Phone is controlling this Mac") with a Stop button that ends it immediately.

**Acceptance (Phase 2)**
- Tapping a button on the phone clicks it on the Mac, and typed text appears in the focused field.
- Without `screen.control`, input returns `forbidden`. View still works with only `screen.view`.
- The desktop Stop button ends control within 1 s.

## Phase 3 — Polish (optional)
Multi-monitor switching, a low-data mode on cellular (lower fps and quality), and only sending changed regions if CPU or bandwidth demands it.

## Granting the new permissions (until there's a UI)
Same documented method as today: with Dobius+ **closed**, add `"screen.view"` (and later `"screen.control"`) to the phone's `grants` in `~/Library/Application Support/dobius-plus/dobius-devices.json`. Helper: `/Volumes/Storage/dev/grant-terminal-send.sh` (edit the list). Stretch goal: a per-phone permissions panel in Settings → Mobile (no UI exists today, only list/revoke).

## How to test on Carson's phone (no reinstall for JS-only changes)
- Phone JS loads live from Metro: run detached from `dobius/mobile` with `REACT_NATIVE_PACKAGER_HOSTNAME=100.94.52.53 pnpm exec expo start --dev-client --port 8081`.
- Desktop changes need a rebuilt and reinstalled **desktop** app. Use the repo's gated install (`pnpm --dir dobius run build:unpack`, then `scripts/install-dobius-gated.sh`). Coordinate with Sam: the desktop engine is shared work.
- If a phone-side change adds a native module, rebuild and reinstall the phone app (`mobile/scripts/phone-refresh.sh --force`).

## Guardrails
- Never push or touch `main`. One commit per numbered step. No secrets in commits.
- Don't widen existing grants. New capability = new grant, off by default.
- Don't stream or log screen frames to disk, telemetry or Metro logs.
- Don't modify `/Users/bayou/Projects (Code)/...` (someone's uncommitted work lives there).
- Desktop install only through the gated script, and only with Carson's OK (installing restarts his running Dobius+).

## Risks
- Screen Recording and Accessibility prompts appear on the Mac, so the first run needs Carson at the desk.
- `desktopCapturer` polling may be slow on a loaded Mac (the Mac ran out of memory earlier today). Keep fps low by default.
- This is the most sensitive permission in the app. Keep both grants off by default, show visible indicators, and make Stop work.
