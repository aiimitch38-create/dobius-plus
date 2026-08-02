# Buzz Desktop frontend snapshot

This directory vendors the complete React desktop frontend from the in-house
Buzz fork at `/Users/bayou/Projects (Code)/buzz`.

- Fork branch: `feat/dobius-takeover-phase-1`
- Fork commit: `81d7e829e`
- Original project: `block/buzz`
- Original license: Apache-2.0 (preserved in `LICENSE`)
- Included: `src/`, `public/`, frontend configuration, tests, and the complete
  `src/testing/e2eBridge.ts` command oracle
- Excluded: `src-tauri/`, `node_modules/`, and generated `dist/`

## Integration boundary

Buzz remains a separate renderer hosted by the Dobius+ Buzz tab. This preserves
its router, global styles, keyboard shortcuts, overlays, unread state, agent
creation flows, and huddle UI as one coherent application. Dobius+ supplies an
Electron compatibility bridge for the former Tauri APIs.

Do not edit this snapshot mechanically without recording the fork commit used
for the update. Product-specific bridge code belongs outside this directory.
