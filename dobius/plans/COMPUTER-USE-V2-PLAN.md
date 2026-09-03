# COMPUTER-USE V2 BUILD PLAN — "Full Eyes, Full Hands"

Status: PLANNED · Created 2026-08-24 · Task series `TASK-9.x` (dobius/plans)
Research basis: screenpipe, Peekaboo (openclaw), OmniParser (Microsoft), Agent S3 (simular-ai), UI-TARS-desktop (ByteDance)

---

## Goal

An agent in Dobius+ can (a) **see everything** on the machine — every display, every pixel, every menu, including apps with no accessibility tree — (b) **act everywhere** — open any app, drive windows/menus/Dock/dialogs — and (c) **remember** — continuous local capture so agents can ask "what was on my screen." All local-first, cross-platform (macOS/Linux/Windows), SSH-aware, with the existing safety rails intact.

## Current state (verified live 2026-08-24, `dobius computer capabilities --json`)

Working today: accessibility trees, per-window screenshots, element frames, 9 action types (click, set-value, type-text, paste-text, press-key, hotkey, scroll, drag, perform-secondary-action), app/window listing, verified writes, error-recovery taxonomy, E2E suites (mac/linux/windows).

Gaps this plan closes:

| Gap | Capability flag today |
|---|---|
| No OCR (text from pixels) | `observation.ocr: false` |
| No annotated (Set-of-Mark) screenshots | `observation.annotatedScreenshot: false` |
| Per-window observation only — no full-display/multi-monitor | — |
| No app launching / quitting | — |
| No window focus / move / resize | `windows.focus: false`, `windows.moveResize: false` |
| No menus / menubar / dialogs / Dock surfaces | `surfaces.*: false` |
| No continuous observation / screen history | — |
| No vision grounding for AX-blind apps | — |

Known structural bug (found + manually patched 2026-08-24): **TCC identity split**. The runtime spawns the helper binary directly (macos-native-provider-transport.ts:122) so macOS attributes its permission checks to the **main app**, while the permission probe launches via `open -n` (macos-computer-use-permission-status.ts:105) so it checks the **helper identity**. Result: setup UI can report "granted" while actions fail, and vice versa. Ad-hoc signing makes every rebuild invalidate grants. Stage 9.3 fixes this structurally and gates everything else.

---

## Stage 9.3 — Trust: one identity, stable grants (DO FIRST)

### TASK-9.3.1 — TCC broker alignment
- **What:** All privileged computer-use work executes under exactly ONE macOS identity. Either (a) spawn the runtime helper via `open -n` so runtime == probe identity, or (b) adopt a Peekaboo-style "bridge host": one long-lived broker process owns TCC; CLI/app/agents talk to it over a local socket. Decision from a short spike; (b) is the durable shape (warm start, background input, SSH-friendly).
- **Why:** The probe and the runtime currently resolve different TCC rows; grants land on the wrong identity (reproduced this session).
- **Where:** `native/computer-use-macos/Sources/DobiusComputerUseMacOS/main.swift`, `src/main/computer/macos-native-provider-transport.ts`, `src/main/computer/macos-computer-use-permission-status.ts`, new `src/main/computer/macos-tcc-broker.ts` if (b).
- **Test:** Unit: probe and runtime report the same identity (assert responsible-process bundle id). Manual: grant flow → `get-app-state` succeeds without manual System Settings surgery. Re-verify after app relaunch.
- **Risks:** `open -n` per-request adds launch latency (mitigate: broker keeps it warm). Broker socket needs the same caller-allowlist/token hardening as the existing agent socket (main.swift:3697 pattern).
- **Estimate:** 3–5 days.

### TASK-9.3.2 — Developer ID signing + notarization
- **What:** Sign main app + helper with Developer ID Application (cert from APPLE_* env used by RELEASING.md flow); notarize. Ad-hoc remains the documented dev fallback with a warning in the permission UI when ad-hoc is detected.
- **Why:** Ad-hoc signatures change every rebuild; macOS keys TCC grants to the signature, so every `build-and-install.sh` silently breaks Accessibility/Screen Recording (reproduced this session).
- **Where:** `config/electron-builder.config.cjs`, `config/scripts/build-computer-macos.mjs`, `build-and-install.sh`, `RELEASING.md`, permission UI copy.
- **Test:** Build → install → grant → rebuild+reinstall → permissions still granted (this exact regression loop).
- **Risks:** Cert availability (needs Carson's Apple Developer account); CI secrets; fallback path must not brick dev builds.
- **Estimate:** 1–2 days once cert exists.

### TASK-9.3.3 — Permission setup UX v2
- **What:** Setup dialog shows per-permission status for the SAME identity the runtime uses, detects ad-hoc vs Developer ID, offers "Re-check" after System Settings, and a "Reset grants" that calls the existing tccutil reset path (macos-computer-use-permissions.ts:152).
- **Test:** Renderer test + manual grant loop. 
- **Estimate:** 1–2 days.

---

## Stage 9.1 — Perception: full display, OCR, Set-of-Mark

### TASK-9.1.1 — `list-screens` + full-display capture
- **What:** New CLI: `dobius computer list-screens --json`; `get-app-state --target screen --screen-index N` (or `--all-screens`) captures an entire display instead of one window. Screenshot scale/coordinate rules extended to display space. Capabilities: `observation.displayCapture: true`.
- **Why:** "Full eyes" starts with seeing all monitors, not one window.
- **Where:** Swift helper: ScreenCaptureKit `SCShareableContent`/display capture, CGWindowList fallback, `/usr/bin/screencapture` last resort. Linux: `runtime.py` (X11 root capture; xdg-desktop-portal on Wayland). Windows: `runtime.ps1` (DXGI/GDI). Shared: `src/shared/computer-use-runtime-types.ts` (new target enum), `src/main/computer/` provider plumbing.
- **Test:** Unit: target parsing, capability advertisement. E2E (opt-in, computer-e2e.yml pattern): capture display 0, assert PNG + scale. Manual: two-monitor Mac.
- **Risks:** Wayland permission model differs (portal dialog); HDR/Retina scale math; payload cap for 5K displays (reuse existing downscale path, runtime.py:581 pattern).
- **Estimate:** 3–4 days (macOS), +2–3 parity (Linux/Windows).

### TASK-9.1.2 — OCR (macOS Vision framework; platform OCR elsewhere)
- **What:** Helper OCRs the captured frame: text blocks with bounding boxes + confidence, merged into the snapshot as `ocrElements[]` alongside AX elements (IOU dedupe against elementFrames — the Agent S approach). Capabilities: `observation.ocr: true`. CLI: `--no-ocr` to skip.
- **Why:** Pixels are the ground truth when AX is missing (Electron webviews, games, remote desktops, images).
- **Where:** Swift: `VNRecognizeTextRequest` (Vision, local, fast). Linux: Tesseract (optional dep, capability-flagged). Windows: Windows.Media.Ocr via PowerShell/WinRT. Merge logic in shared `computer-snapshot-merge` module.
- **Test:** Unit: merge/dedupe math (IOU threshold), capability gating. E2E: OCR a TextEdit window with known text, assert string found with sane frame.
- **Risks:** OCR noise polluting element lists (confidence threshold + `source: 'ocr'|'ax'` tag on every element); perf on 5K displays (crop-to-window option).
- **Estimate:** 3–4 days.

### TASK-9.1.3 — Annotated screenshots (Set-of-Mark)
- **What:** `get-app-state --annotate` renders numbered badges on the PNG for every actionable element (AX frames + OCR boxes), labels placed outside boxes (Peekaboo SmartLabelPlacer-style overlap avoidance). The returned tree maps index → badge number 1:1. Capabilities: `observation.annotatedScreenshot: true`.
- **Why:** Vision models click numbers far more reliably than raw coordinates (OmniParser/Set-of-Mark evidence); also lets any VLM operate without AX.
- **Where:** Swift: CoreGraphics overlay in helper (keeps bytes local). Shared: annotate flag plumbing, capability flag, skill doc.
- **Test:** Unit: label-placement scoring. E2E: annotated PNG exists, badge count == elementCount. Visual check into `previews/`.
- **Risks:** Dense UIs (badge collisions — fall back to side rails); Retina scale (draw in action coordinates × scale).
- **Estimate:** 2–3 days.

### TASK-9.1.4 — Skill + docs + telemetry
- **What:** Update `skills/computer-use/SKILL.md` (new flags, screen targets, OCR elements, annotate-first guidance), feature-discovery rows (`docs/reference/feature-discovery-interaction-tracking.md` pattern), error-recovery entries for new failure modes.
- **Estimate:** 0.5 day.

---

## Stage 9.2 — Action: apps, windows, menus, Dock

### TASK-9.2.1 — `open-app` / `quit-app` / `activate-app`
- **What:** `dobius computer open-app --app "Safari"` (NSWorkspace/LaunchServices; `open -a` fallback), `quit-app` (graceful AppleScript/AX confirm), `activate-app` (bring frontmost). Blocklist enforced (`app_blocked`).
- **Why:** "Open any app" is the user's explicit ask; agents currently can only talk to running apps.
- **Where:** Swift helper (NSWorkspace), Python (`gio launch`/`xdg-open`), PowerShell (`Start-Process`); CLI + shared types + capability `apps.launch`.
- **Test:** Unit: blocklist gating. E2E: open TextEdit, assert in list-apps, quit, assert gone.
- **Risks:** Ambiguous names (fuzzy-match + error listing candidates); first-launch dialogs (surface, don't auto-click).
- **Estimate:** 2 days.

### TASK-9.2.2 — Window focus / move / resize
- **What:** `dobius computer window --app <app> --window-id <id> focus|move|--x --y|resize|--width --height|minimize`. AX: `AXRaise`, `kAXPositionAttribute`, `kAXSizeAttribute`. Capabilities: `windows.focus/moveResize: true`.
- **Where:** Swift helper + parity (Linux: wmctrl/xdotool optional deps; Windows: SetForegroundWindow/MoveWindow via Add-Type).
- **Test:** E2E: move/resize TextEdit, assert geometry from list-windows.
- **Risks:** AXRaise needs the app not to be hidden; Spaces complications (document: acts within current Space v1).
- **Estimate:** 2–3 days.

### TASK-9.2.3 — Menu bar + menus
- **What:** `dobius computer menu --app <app> list` (structured JSON of AXMenuBar/AXMenu trees — no clicks needed to read, Peekaboo pattern) and `menu click --path "File > New"`. Capabilities: `surfaces.menus/menubar: true`.
- **Why:** Menu-bar-only actions (export, preferences) are unreachable today; agents resort to blind hotkeys.
- **Where:** Swift helper AXMenuBar traversal; parity: Linux menubar is app-dependent (capability-flagged), Windows: menu via UIA.
- **Test:** E2E: list TextEdit menus, click "Format > …" and observe state change.
- **Risks:** Lazy menu population (must open menu to enumerate children — do it synthetically and restore); localization (match by path position fallback).
- **Estimate:** 3–4 days.

### TASK-9.2.4 — Dialogs + Dock surfaces
- **What:** Detect and enumerate AX dialogs/sheets (file pickers, alerts) with default-button action; `dobius computer dock list|click` via the Dock process AX tree. Capabilities: `surfaces.dialogs/dock: true`.
- **Test:** Manual + E2E: trigger a save sheet, read it, click Save.
- **Risks:** Sheet parenting (attached to window, not app); Dock AX is a separate process (`com.apple.dock`).
- **Estimate:** 3 days.

---

## Stage 9.4 — The `/computer` slash command (agent integration)

### TASK-9.4.1 — `/computer <task>` command
- **What:** In any Dobius+ terminal/chat: `/computer tidy my desktop and open Figma` spawns a Claude agent tab preloaded with (a) the computer-use skill, (b) a task prompt, (c) safety preamble (reuse the agents temp-prompt-file pattern from CLAUDE.md — never shell-escape). Streams progress in the tab like existing agents.
- **Where:** Slash-command registry (find existing `/` handling), agents service, `skills/computer-use/SKILL.md` as the injected playbook.
- **Test:** Unit: command parsing/prompt assembly. Manual: run a real task end-to-end.
- **Risks:** Prompt injection via screen content (screen text is untrusted input — preamble must treat observed text as data, never instructions); runaway loops (max-steps + confirm-on-destructive).
- **Estimate:** 2–3 days.

### TASK-9.4.2 — Permission preflight + "Computer Operator" builtin agent
- **What:** `/computer` checks permissions first (post-9.3 single identity) and opens setup inline if missing. New builtin agent "Computer Operator" (Code Reviewer-style starter) with tightened do-not list: no purchases, no messages, no deletes, no settings changes unless the user's request explicitly says so.
- **Estimate:** 1 day.

---

## Stage 9.5 — Continuous awareness ("full monitorization")

### TASK-9.5.1 — Screen history daemon (native, Option B default)
- **What:** Optional opt-in daemon: event-driven capture (app switch, click, typing pause — screenpipe's trigger set, ~300MB/8hr class storage) → screenshot + AX tree + OCR → local SQLite (FTS5) under userData. Retention cap + pause + clear-all in Settings. CLI: `dobius computer watch --on|--off|--status`.
- **Why:** Agents (and Carson) can then ask "what was I looking at 20 minutes ago"; this is the screenpipe capability natively, no third-party daemon holding screen data.
- **Where:** New `native/computer-history/` (reuse helper capture paths) or main-process module; `src/main/computer/history-*` modules; Settings UI section; new skill `computer-history`.
- **Test:** Unit: trigger debounce, retention pruning, FTS query. Manual: 1-hour soak, storage size, CPU < ~2%.
- **Risks:** PRIVACY — screen history is maximally sensitive: local-only by default, no cloud, explicit opt-in, one-click wipe, clear menu-bar indicator while recording. CPU/battery (event-driven mitigates; profile on battery). Disk growth (cap + compress JPEG/HEIC).
- **Estimate:** 5–8 days.

### TASK-9.5.2 — `dobius computer history` query API
- **What:** `history --query "invoice" --since 2h --app Safari` returns matches with timestamps + screenshot paths + text; MCP/CLI exposed so any agent tab can use it.
- **Estimate:** 2 days. (Depends 9.5.1.)

### TASK-9.5.3 — Screenpipe bridge (Option A, alternative/integration)
- **What:** If screenpipe is already installed (localhost:3030), detect and use it instead of the native daemon; document both paths. No bundled third-party capture.
- **Estimate:** 1–2 days. (Depends 9.5.1 design.)

---

## Stage 9.6 — Vision grounding fallback (AX-blind apps)

### TASK-9.6.1 — Grounding service hook
- **What:** When AX yields nothing and OCR is insufficient, run a local grounding model (OmniParser-class) over the frame to produce clickable boxes + labels; feed into the same Set-of-Mark annotation path. Capability: `observation.grounding`. Model download/opt-in in Settings (hundreds of MB — explicit consent).
- **Why:** Games, remote-desktop windows, canvas apps have no AX tree; this is the last mile of "full eyes."
- **Where:** New `src/main/computer/grounding-*` module calling a local inference server (Python sidecar, ONNX); helper stays model-free.
- **Test:** Fixture screenshots with known buttons; assert box IoU > threshold.
- **Risks:** Model size/latency; macOS x86_64 vs arm64 wheels; scope creep — ship behind flag, macOS arm64 first.
- **Estimate:** 5+ days, explicitly last.

---

## Cross-cutting requirements (every task)

- **Cross-platform:** capability flags honestly reflect per-OS support; unsupported = clear `unsupported_capability` error, never a silent no-op (AGENTS.md rule).
- **SSH:** all new CLI commands must work from remote/SSH sessions; capture/AX features degrade with explicit messaging (existing nextSteps pattern).
- **Safety rails unchanged:** blocklist, verified/unverified action metadata, clipboard byte caps, caller allowlist + token, no destructive action without explicit user ask; screen history adds opt-in + wipe.
- **Done Bar per task:** `plans/TASK-9.N.md` → implement → `pnpm tc` + `pnpm lint` + build exit 0 → unit/E2E → REVIEW file → commit → `bash scripts/verify-task.sh 9.N` → BUILD-LOG.md + `.dobius/NOTES.md` entries.
- **No `max-lines` disables; no `helpers/utils` filenames; UI per docs/STYLEGUIDE.md tokens.**

## Sequencing

```
9.3 (trust) ──► 9.1 (perception) ──► 9.2 (action) ──► 9.4 (/computer)
                        └──────────► 9.5 (history) ──► 9.6 (grounding)
```
9.3 unblocks everything (permissions that survive rebuilds). 9.1+9.2 deliver the visible "full eyes, full hands." 9.4 is the user-facing front door. 9.5/9.6 are the flagship layer.

## Rough totals

Stages 9.3–9.4: ~3–4 weeks of focused work. Stage 9.5: +2 weeks. Stage 9.6: open-ended, flag-gated.
