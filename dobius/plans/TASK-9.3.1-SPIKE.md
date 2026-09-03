# TASK-9.3.1 SPIKE — TCC identity attribution (read-only, evidence first)

Part of COMPUTER-USE-V2-PLAN.md (dobius/plans/COMPUTER-USE-V2-PLAN.md). Wave 1. No code changes.

## Question
When the computer-use helper binary runs, which TCC identity do its permission checks resolve against — and does it differ between launch modes?

Known facts (2026-08-24 session):
- Runtime path: `src/main/computer/macos-native-provider-transport.ts:122` spawns the helper binary DIRECTLY (`--agent <socket> --token-file <path>`); main.swift:604 gates requests on `AXIsProcessTrusted()`.
- Probe path: `src/main/computer/macos-computer-use-permission-status.ts:105` launches via `open -n` with `--permission-status-file`; its comment claims direct exec "can inherit the parent app's already-granted context."
- Observed: probe reported accessibility=granted while runtime requests returned permission_denied.

## Method
1. Launch the installed helper both ways (`open -n` with status file; direct exec of the binary with status file) and diff the JSON.
2. Also spawn the helper binary from a plain terminal process and compare (terminal as parent).
3. Read main.swift agent-mode startup for any re-exec/`open` fallback logic.
4. If results are inconclusive (both granted now), say so — do not force a conclusion.

## Deliverable (final message, structured)
- Evidence table: launch mode → accessibility result → screenshots result → inferred responsible identity.
- Recommendation: option (a) transport switches to `open -n` spawn, or (b) long-lived broker process owns TCC — with tradeoffs (latency, SSH, background input) and the smallest correct first step.
- Any surprise findings (e.g. helper already re-execs, or attribution differs per permission).

## Guardrails
- Read-only: NO file modifications, NO git, NO builds, NO installs.
- Never kill the main Dobius+ app or its daemon Helper (daemon-entry.js).
- Foreground `sleep` is blocked in this harness — use run_in_background and poll on a later turn.
