# TASK-VOICE-5.1 — review

Re-read all four changed files after implementation.

- `proactive-watcher.ts` — `matchedMarker` duplicates classifyOutcome's
  normalization (2 lines) instead of restructuring the existing function;
  deliberate — keeps classifyOutcome's signature and its 20+ call/test sites
  untouched.
- `agent-context.ts` — module-level `lastOpening` is process state shared
  across calls; acceptable: one Jarvis conversation at a time by design, and
  `formatOpeningSection` states the standing rule even when the cache is
  empty or stale, so ordering between the two IPC calls cannot lose the rule.
- Openers: hedged failure phrasing verified against classifier reality
  (substring heuristic, known false positives).
- Tests: 4 new, 66 green in the three affected files. Typecheck node OK.
- Fixed one thing on review: kept `expect(record?.line).toBe(line)` so the
  recorded line is proven to be the exact spoken line, not just any string.
