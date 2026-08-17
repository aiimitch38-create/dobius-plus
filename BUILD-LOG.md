# Build Log

## 2026-07-30 — Buzz tab + Buzz app skin (feat/buzz-skin)
- Cloned github.com/block/buzz, traced its design system (theme.css + tailwind.config).
- New Buzz tab in the sidebar opens a recreation of the Buzz workspace UI (BuzzPage.tsx).
- New Buzz App Skin repaints all of Dobius+ with the Buzz gradient look (buzz-skin.css).
- typecheck 0, oxlint 0, app-skin tests 6/6. 16 pre-existing hook-test failures confirmed unrelated (fail on clean tree too).
- Verified in dev app via CDP screenshots, light + dark. Committed locally; not pushed (local-first).

## 2026-07-30 (late) — Buzz Phase 0 complete
- All 4 wiring reports delivered + saved to Docs/Buzz-Takeover/wiring-reports/ (relay core, ACP harness, agent toolkit, UI shim surface).
- Colima + Docker up; buzz fork cloned to ~/Projects (Code)/buzz (remote=upstream); just setup green (postgres/redis/minio healthy, migrations applied).
- buzz-relay compiled (6m19s) and running detached on port 3300 (3000 was pocket-cologne preview — left untouched). RELAY_URL=ws://localhost:3300; BUZZ_AUTO_MIGRATE=true; using dev signing key (local-only; set BUZZ_RELAY_PRIVATE_KEY before any network exposure).
- Buzz.app launched with BUZZ_RELAY_URL=ws://localhost:3300 — connected, authenticated, posting events (HTTP bridge 200).

## 2026-07-31 — Phase 3 smoke PASSED: first Claude agent live in Buzz
- buzz-cli/buzz-acp/buzz-admin built (3m20s). claude-agent-acp v0.64.0 installed (speaks protocol v1 → legacy framing, works; token-heavier, revisit).
- Agent "Scout" born: key in ~/.config/buzz-agents/scout.env (chmod 600), profile set, created open channel #agent-lab, cwd pinned to ~/dobius/projects/buzz-agent-workspace.
- Harness pool running (respond-to anyone). Tester identity mentioned @Scout; Scout replied in-channel with a real Claude-generated answer including its correct pinned cwd. Text-an-agent loop VERIFIED end to end (verified by reading the actual channel message, not logs).
