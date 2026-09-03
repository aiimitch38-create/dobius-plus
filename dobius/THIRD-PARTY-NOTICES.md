# Third-party notices

## Buzz Desktop (block/buzz)

The Communications tab in Dobius+ is derived from the Buzz desktop client.

- **Upstream project:** `block/buzz`
- **Copyright:** Copyright 2026 Block, Inc.
- **Licence:** Apache License, Version 2.0 — full text in
  [`LICENSE-APACHE-2.0-block-buzz.txt`](./LICENSE-APACHE-2.0-block-buzz.txt)
- **Snapshot taken from:** the in-house fork at branch
  `feat/dobius-takeover-phase-1`, commit `81d7e829e`
- **Where it lives now:** `src/renderer/src/components/communications/`

### Changes made to the original

Apache 2.0 §4(b) requires modified files to carry prominent notice of change.
The whole vendored tree has been modified; the changes are:

- Runs as a React subtree inside the Dobius+ renderer rather than as a
  standalone application. The upstream `main.tsx` entry point is unused; the
  provider stack it defined now lives in `CommunicationsPage.tsx`, minus the
  ReactDOM root, the E2E bridge, and the identity bootstrap.
- The router runs on memory history instead of hash history, so it owns only
  its subtree and never touches `window.location`.
- Every `@tauri-apps/*` import resolves to an Electron-backed shim in
  `tauri-shim/`; no Tauri package is installed or shipped.
- Identity is held by the Dobius+ main process, encrypted at rest. Upstream
  wrote a Nostr private key to `localStorage` in plain text; that bootstrap is
  deliberately not carried over.
- Rebranded to Dobius: user-facing text, the mark, the loading screen, and the
  starter agent names. `shared/ui/buzz-logo/` was removed and replaced by
  `shared/ui/dobius-logo/`.

Internal identifiers (CSS class names, storage keys, environment variable
names, and module names such as `buzzAgentConfig`) still carry the upstream
`buzz` prefix. They are not user-visible, and leaving them is the honest
record of where the code came from.

## Harness logos

`src/renderer/src/components/communications/features/onboarding/assets/harness-logos/`
holds third-party marks used nominatively to identify the agent runtimes
Dobius+ can drive. Each remains the property of its owner and is not rebranded.

Also nominative, inline in `features/onboarding/ui/HarnessMarks.tsx`: the Goose
mark, from Block's `goose` repository (Apache-2.0).
