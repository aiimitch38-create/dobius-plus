# REPAIR BUILD-009B — migrate the remaining JSON stores to SafeJsonFile (#30 follow-up)

## Root cause
Same as BUILD-009 (#30). Each store below did `try { JSON.parse(readFileSync(...)) } catch { cache = [] }`
(or dropped entries that failed a sanitizer), and the next save renamed that empty or filtered
value over the real file. ENOENT, EACCES, truncated JSON, wrong shape and one bad entry were
all treated as "no data". BUILD-009 fixed 8 stores. This build covers the rest outside the
files owned by other builds.

## Fix
- `storage/safe-json-file.ts` (backward compatible, both tested):
  - `mode?: number` option on `SafeJsonFileOptions`, passed through `writeJsonFileAtomic` /
    `writeFileAtomic` to the unique temp file. Needed because Jira/Linear wrote their account
    metadata with `mode: 0o600`; without it the migrated files would become 0644.
  - `parseEveryValue(raw, parseEntry)`: `parseEveryEntry` for id-keyed JSON objects. undefined
    (→ unreadable) when the value is not a plain object or any entry is malformed.
- 14 stores migrated. Every store keeps its file name, directory and JSON format. A missing file
  keeps its first-run default. A malformed entry now makes the file unreadable (CX12 F2 rule)
  instead of being dropped and then saved over.
- Save-failure contract kept per store:
  - communications/agents (4 stores): old `persist()` threw → now throws when `set()` returns
    false, so the RPC caller sees that nothing was saved.
  - canvas, workflows, destinations, prompts, asana local-done: old code warned and continued →
    `set()` return ignored (SafeJsonFile logs the refusal).
  - jira/linear: old write threw, but `clearToken()` has 41 call sites, most inside auth-error catch paths
    (jira/issues.ts, linear/issues.ts, projects.ts, teams.ts…). A throw there would replace the
    real error, so they do not throw; the change stays for the session and the file is kept.
  - crash-report-store (async, no cache, re-reads each call): uses `readSafeJsonFile` +
    `keepUnreadableCopy`; `withWrite()` throws while the file is unreadable (the old write path
    already threw on failure; callers catch it: index.ts:1278 `.catch`, ipc/crash-reporting.ts recordRendererError + markSent try/catch; `dismiss` rejects to the renderer as before).

## Inventory (every JSON-file read in src/main that is followed by a write of that file)
Line numbers are the `JSON.parse` line on the pre-fix base (`e2d5d948`).

Migrated:
| Store | File | JSON.parse |
|---|---|---|
| asana local-done | asana-local-done.json | asana/asana-queue-service.ts:30 |
| agent overrides | communications-agent-overrides.json | communications/agents/agent-local-overrides-store.ts:71 |
| custom harnesses | communications-custom-harnesses.json | communications/agents/custom-harness-store.ts:86 |
| global agent config | communications-global-agent-config.json | communications/agents/global-agent-config-store.ts:84 |
| observer channel index | communications-observer-channel-index.json | communications/agents/observer-channel-index-store.ts:71 |
| channel templates | channel-templates.json | communications/canvas/channel-template-store.ts:37 |
| save subscriptions | save-subscriptions.json | communications/canvas/save-subscription-store.ts:35 |
| workflow runs | workflow-runs.json | communications/workflows/workflow-run-store.ts:115 |
| workflows | workflows.json | communications/workflows/workflow-store.ts:121 |
| crash reports | crash-reports.json | crash-reporting/crash-report-store.ts:153 |
| destinations | destinations.json | destinations/destinations-store.ts:71 |
| Jira sites | ~/.dobius/jira-sites.json (0600) | jira/client.ts:156 |
| Linear workspaces | ~/.dobius/linear-workspaces.json (0600) | linear/client.ts:196 |
| prompts | prompts.json | prompts/prompts-store.ts:40 |

Not migrated, not this pattern (checked):
- `keybindings/keybinding-file.ts:54` — already fails closed: `writeKeybindingOverride` throws when the read failed.
- `agent-trust-presets.ts:77` — returns without writing on a parse error.
- `agent-hooks/installer-utils.ts:73`, `installer-utils-remote.ts:42` — return `null`; every caller (droid/gemini/cursor hook-service) refuses to write on `null`.
- `claude-accounts/runtime-auth-service.ts:1821` (`readJsonObject`) — returns `null` on bad JSON on purpose.
- Marker files written from fresh values, never read-modify-write: `startup/gpu-fallback-marker.ts:39`, `startup/windows-user-data-acl.ts:60`, `codex/codex-home-paths.ts:148`, `codex/codex-session-bridge.ts:331`, `terminal-history.ts:290`, `codex-accounts/runtime-home-service.ts:1504`.
- `migrate-legacy-dobius-config.ts:62` — reads the legacy file, writes other files, never writes it back.
- `rate-limits/gemini-oauth-sources.ts:43/58` — non-ENOENT errors and bad JSON throw; nothing is written.
- `linear/client.ts:122` (linear-viewer.json) — read-only, only ever deleted.
- `communications/relay/relay-store.ts` — SQLite; bad rows throw.
- Derived caches, rebuilt by the scanner from the source logs, where the code explicitly documents "start fresh": `claude-usage/store.ts:329`, `codex-usage/store.ts:339`, `opencode-usage/store.ts:165`, and `opencode/hook-service.ts:483` (overlay manifest). Losing them loses no user data; blocking their saves would stop the feature from ever rebuilding. Left as is (see "Reviewer must check").

Found but out of scope (different mechanism, not SafeJsonFile-shaped):
- `remote-agent-trust-presets.ts:66-75` `readRemoteTextFile` returns `''` on ANY remote read error; `markRemoteCopilotFolderTrusted` (:129) and `markRemoteCodexProjectTrusted` (:85) then write a fresh file over the user's remote `~/.copilot/config.json` / `~/.codex/config.toml`. Same fail-open, but a remote SFTP file; needs its own fix.
- `claude-accounts/runtime-auth-service.ts:1323-1337` `readSystemDefaultSnapshot` `rmSync`s the system-default auth snapshot on ANY read or parse error (EACCES included). Credential area; flag only.

Excluded (owned by other builds), still showing the pattern:
- `imessage-bridge/bridge-config.ts:80`, `voice-conductor/lead-tab-store.ts:53`, `voice-conductor/persistent-work-registry.ts:38`, `stats/collector.ts:167` (documented "start fresh"), `agent-hooks/server.ts:1482` (last-status hydration, rewritten from live state).
- `speech/openai-api-key-store.ts:42` returns null on a bad legacy JSON key file; key-store semantics for its owner to confirm.
- automations/*, runtime/orchestration/*, agents/agent-identity-files.ts: no JSON-file store with this pattern (external-manager.ts:134/164 only read third-party job files; orchestration is SQLite).

## Deviations
- Edited `safe-json-file.ts` (allowed by the brief when a capability is missing): `mode` option and
  `parseEveryValue`, both backward compatible, with tests.
- Store files outside `userData` (Jira/Linear under `~/.dobius`) are included: same pattern.
- Paths stay `app.getPath('userData')` where the store used it (not `getUserDataRoot()`); moving
  roots is BUILD-014's job and would move data files.
- Mid-build the coordinator asked to merge `stabilize/integration` (BUILD-018 changed jira/linear
  token writing to fail closed). The branch had no commits, so it was fast-forwarded to
  `e2d5d948`; the jira/linear diffs were re-applied with `git apply -3`. Only the test-file
  imports/tails conflicted (kept both). BUILD-018's token functions are untouched;
  `grep -n "storing token in plaintext"` on both files prints nothing.
- Existing test `workflow-store.test.ts` "drops a workflow record whose stored YAML no longer
  parses" renamed and extended: the record is still not served, and now the file is also not
  overwritten by the next save.

## Tests
- `src/main/storage/safe-json-store-migrations-009b.test.ts` (new, style of BUILD-009's):
  11 userData stores × (truncated file, one malformed entry) → load + every save API → same bytes,
  same mtime, no temp, exactly one quarantine copy; well-formed files load with nothing
  quarantined; missing file creates nothing on load and saves normally.
- `crash-report-store.test.ts`: 3 bad files (bad JSON, `reports` not a list, top-level array) →
  `record`/`dismiss` reject, bytes + mtime unchanged, no temp, one copy each; repaired file
  records again; missing file records normally.
- `jira/client.test.ts`, `linear/client.test.ts`: truncated / malformed entry / wrong-type list →
  getStatus, select, clearToken, disconnect never touch the file; readable file saves as 0600.
- `safe-json-file.test.ts`: `mode` option; `parseEveryValue`.
- Mutation checks (each made tests fail, then restored):
  - M0 all 14 store sources reverted to base (safe-json-file kept) → 32 tests fail (every new store case).
  - M1 `mode` not passed to the write → 3 fail (safe-json mode, Jira 0600, Linear 0600).
  - M2 `parseEveryValue` skips bad entries → 5 fail (unit + overrides, harness, observer, workflow-runs).
  - M3 crash store writes while unreadable → 1 fail.
  - M4 Jira drops a malformed site instead of refusing → 1 fail.
  - M5 overrides store ignores a refused save → 2 fail.

## Verification
- `pnpm run typecheck` exit 0.
- Targeted: 56 files / 496 tests green (storage, communications/{agents,canvas,workflows},
  crash-reporting, jira, linear, destinations, prompts, asana, rpc channel-templates +
  save-subscriptions, ipc/linear) — includes BUILD-018's jira/linear tests.
- oxlint + react-doctor clean on every changed file (checked one file with a planted `curly`
  error to confirm oxlint really lints these paths).
- Full suite: DEFERRED (coordinator).

## Rollback
Revert the commit. Quarantine copies (`*.unreadable-<ms>`) stay on disk. Files written by the
new code keep the same JSON shape (plus a trailing newline), so old code reads them.

## Lessons
- `ASANA_GID_RE` needs 6+ digits; a test gid of `'123'` is silently ignored by `markLocalDone`.
- Stores that threw on write failures and stores that warned must keep their own contract;
  jira/linear are the exception because `clearToken` sits inside auth-error catch blocks.

## Review round 1 (F1, F2)
Merged `stabilize/integration` (6c753d3c, BUILD-028) first; clean merge.

- F1 [medium] User-edit stores ignored `false` from `set()`, so IPC/RPC returned the new list
  and the edit vanished on restart. New `SafeJsonFile.save(value)`: calls `set()`; on refusal it
  drops the refused change from memory (`invalidate()`, since callers mutate the cached value in
  place) and throws `<file> can't be read, so changes are not saved; repair or remove it`
  (or `<file> could not be saved` for a plain write failure). Used by prompts, destinations,
  workflows, channel templates and save-subscriptions.
  - Renderer callers: `PromptsPanel` save/delete had no catch (unhandled rejection, nothing
    shown) → now `toast.error` and the editor stays open. `DestinationsSection` delete had no
    catch → `toast.error`; its save already toasted. Workflows / channel templates /
    save-subscriptions are RPC methods: `runtime/rpc/dispatcher.ts:183` maps a thrown error to
    an RPC error reply (the path "not found" errors already use).
  - Warn-and-continue kept for Jira/Linear, asana-local-done and workflow-runs. SafeJsonFile
    already logs exactly one `console.error` naming the file per unreadable state
    (`<label> not saved: ...`); tests now assert exactly one across repeated refused saves.
- F2 [low] `global-agent-config-store`: a stored `config` that is not an object, `env_vars`
  that is not an object, or any non-string env value now makes the file unreadable. `""` stays
  valid (inherit) and is still stripped. Input sanitizing for `setGlobalAgentConfig` unchanged.

Tests: safe-json-file.test.ts (`save()` ×3), safe-json-store-migrations-009b.test.ts (5 user-edit
stores expect the thrown message and an empty re-list; one-error logging for workflow-runs and
asana-local-done; F2 ×3 + "" inherit), jira/linear one-error assertions, new
`PromptsPanel.test.tsx` and `DestinationsSection.test.tsx`, workflow-store test expects the throw.

Mutations (each failed, then restored): F1a `save()` returns instead of throwing → 12 fail;
F1b refused change kept in memory → 12 fail; F1c prompts back to `set()` → 2 fail; F1d
PromptsPanel catch removed → 1 fail; F1e Destinations delete catch removed → 1 fail; F1f log
every refusal → 5 fail; F2 inner-field check removed → 3 fail.

Verification: typecheck exit 0; targeted 58 files / 501 tests: 499 passed + workflow-store test
fixed after the run (re-run green) + `storage/user-data-root.test.ts` timed out at 30 s under
load average ~35 (untouched file; passes alone: 2 files / 40 tests green). oxlint + react-doctor
clean on all changed files.
