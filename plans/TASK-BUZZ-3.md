# TASK-BUZZ-3 — Phase 2: complete Buzz UI/UX inside Dobius+

## Acceptance gate

Phase 2 is complete only when the vendored Buzz renderer works in its own
Dobius+ tab against the local relay. Visual parity alone is insufficient.

- Full onboarding and identity flow
- Channel and DM navigation, messaging, threads, mentions, and reactions
- Search/Command-K, unread state, typing, presence, and notifications
- File drag/drop and media rendering
- Agent creation/editing backed by the Dobius+ agent factory
- Agent turn choreography and runtime status
- Stack-down fallback instead of a blank guest surface

## Architecture

The complete Buzz desktop frontend lives in `dobius/vendor/buzz-desktop` and
runs as an isolated renderer hosted in the Buzz tab. An Electron bridge keeps
the former Tauri command/event contracts. Buzz's `e2eBridge.ts` is the command
oracle; production implementations move into focused Dobius+ main/preload
modules rather than a single monolithic shim.

## Build order

1. Vendor the complete frontend and preserve its license/source marker.
2. Add the isolated renderer host and stack-down fallback.
3. Create the Buzz renderer build entry and package it with Dobius+.
4. Implement identity/keyring and relay-session bridge commands.
5. Implement channels/messages/media and desktop UX commands/events.
6. Connect managed-agent commands to the Dobius+ factory.
7. Run the full UX parity checklist and relay-backed tests.
