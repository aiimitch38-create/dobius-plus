# REPAIR BUILD-032 — iMessage inbox integrity and terminal guard (#12 #13 #14 #16 N12)

## Root causes
- **#12** `bridge-service.ts` `dispatchCommand` typed any `d:` iMessage text + Enter into whatever
  terminal was active, with no check of the foreground process. An idle shell executed it as a
  shell command. It also logged the first 80 chars of the command text.
- **#12 (Codex addition)** BUILD-001's pause gate ran once at the top of `dispatchCommand`; the
  `resolveActiveTerminal()` await (and the runtime's 500 ms text→Enter gap) let a pause flipped
  mid-send still type and submit the command.
- **#13** `pollNewMessages` advanced `lastSeenRowid` once, after the whole batch, and fired
  `dispatchCommand` with `void`. A throw on any later row (e.g. `handleChannelMessage`) skipped the
  watermark update, so already-typed commands were re-typed on every 2 s poll. Unawaited dispatches
  could also interleave two commands' text and Enters in one terminal.
- **#14** `NEW_MESSAGES_SQL` accepted `handle.id = ? OR chat.guid LIKE %handle%`: a longer number or
  an email containing the handle matched, `%`/`_` in the handle were wildcards, and `handle.id = self`
  also matched outgoing rows in group chats.
- **#16** `imessage-send.ts` spliced the handle into the AppleScript source with only `"` removed
  (`\` survived); text was escaped but still string-built.
- **N12 (deep-report B11)** `dispatch-server.ts` `/tabSend` awaited `resolveActiveTerminal` +
  `sendTerminal` with no timeout (every sibling route has one); `/tabRead` passed any `body.limit`
  number through unvalidated.

## Fix
- New `imessage-bridge/terminal-send-guard.ts` (split out so bridge-service stays under max-lines):
  `assertSendAllowed(target, handle)` = runtime `getTerminalAgentStatus(handle)` must report
  `isRunningAgent` and not `status: 'permission'` (the same rule terminal.send applies for
  `requireAgentStatus: 'sendable'`, `runtime/rpc/methods/terminal.ts` ~922-938, called through the
  runtime API, that file not edited), then `checkExecutionAdmission('imessage-command')` last,
  after the await. `dispatchFailureReply` maps refusals to iMessage replies.
- `dispatchCommand`: BUILD-001 gate stays first. Target is resolved once and pinned (explicit
  handle, never re-resolved). `assertSendAllowed` runs before the send and again as the runtime's
  `sendTerminal(..., { beforeWrite })` hook, which the runtime calls before every text chunk and
  before the Enter. Refusal before any write → "command not sent"; refusal after typing started →
  "not submitted, may be partly typed". Log line no longer contains command text.
- `ImessageBridgeTerminalDispatcher` gains `getTerminalAgentStatus` and the `sendTerminal` options
  arg; `DobiusRuntimeService` already satisfies it structurally (index.ts unchanged).
- `pollNewMessages`: per row, persist `lastSeenRowid = row.rowid` BEFORE handling it (at-most-once:
  a crash/throw never re-types; no exactly-once promise), per-row try/catch so one bad message
  doesn't stop the batch, dispatch awaited (sequential). Accepts an injected DB for tests.
- SQL: exact, case-insensitive `chat.chat_identifier = handle` on a non-group chat
  (`instr(guid, ';+;') = 0`), or, only for rows with no chat link, exact `handle.id`. No LIKE, so
  no wildcard. `GROUP BY message.ROWID` dedupes a message linked to two self chats.
- `sendImessage`: constant `on run argv` script; handle and text passed as osascript arguments.
  Handle validated as phone (`^\+?[0-9][0-9 ().-]{1,30}$`) or email (no whitespace/quote/backslash)
  before anything runs; it can never start with `-`, so osascript option parsing stops before it.
  Text keeps the old control-char strip (newline kept). Verified locally with a harmless
  `osascript -e 'on run argv …'` (no Messages): hostile text came back verbatim as data.
- `/tabSend`: `withTimeout` on resolve (5 s) and send (10 s) like the sibling routes → 500
  `timed out` instead of a hung request. `/tabRead`: `limit` must be an integer 1..2000 (the
  runtime's `MAX_TERMINAL_READ_LIMIT`), else `{ok:false}`; default 200 unchanged. Note the runtime
  already clamps (`terminalReadLimit`), so the limit half was low severity; the boundary now
  refuses instead of silently substituting.
- Mechanical: fixed pre-existing `curly` in dispatch-server `knownHandle`.

## Tests
- `imessage-bridge/bridge-service-integrity.test.ts` (new):
  - #12: idle shell refused (nothing written); permission prompt refused; agent target gets text
    then Enter; agent exits between text and Enter → Enter never written; tab switch mid-send →
    writes and checks stay on the pinned handle; pause flipped during a deferred
    `resolveActiveTerminal` → nothing typed, paused reply; pause flipped between text and Enter →
    Enter never written; command text never appears in console.log/warn.
  - #14: real `node:sqlite` in-memory chat.db: phone handle returns only its 1:1 chat + unlinked
    row (not `+155512345`, not a group chat, not `is_from_me=0`, dedup across two self chats);
    email exact/case-insensitive (not `someme@x.com`); `%` and `_` handles match nothing.
  - #13: rows [d: echo one, boom (channel throws), d: echo three] → poll twice (simulated
    restart) → each command typed exactly once; watermark was already 1 when echo one was written.
- `imessage-bridge/imessage-send.test.ts` (new; `execFile` mocked, no osascript runs): script is
  constant and contains neither handle nor text; args = [handle, text]; hostile handles
  (backslash, quote injection, `-e`, trailing newline, empty) rejected before execFile; control
  chars stripped, newline kept.
- `imessage-bridge/bridge-service-admission.test.ts`: fake terminal gains agent status; send
  assertion includes the `beforeWrite` option.
- `dobius-cli/dispatch-server.test.ts`: `/tabRead` rejects -5, 0, 1.5, 2001, 1e9, '50', null
  without calling the runtime; 50 and default 200 pass. `/tabSend` with a never-resolving send
  answers 500 `timed out` after 10 s (fake timers).
- Targeted: `src/main/imessage-bridge src/main/dobius-cli` → 5 files, 27 tests green.

## Mutation checks (each broke the named tests, then restored; diff-verified)
- M1 drop `!isRunningAgent` refusal → idle shell + exit-race tests fail (2).
- M2 restore `handle.id = ? OR chat.guid LIKE %handle%` → all three #14 tests fail.
- M3 watermark after the loop again → #13 test fails.
- M4 splice handle into the script + drop validation → 6 imessage-send tests fail.
- M5 remove `/tabSend` timeout → timeout test fails.
- M6 remove the limit range check → `/tabRead` test fails.
- M7 drop the pause recheck in the guard → both pause-race tests fail.
- M8 drop the permission refusal → permission test fails.

## Rollback
Revert the commit. No data format changes (`imessage-bridge.json` shape unchanged).

## Deviations from EXECUTION-ORDER.md
- New file `imessage-bridge/terminal-send-guard.ts`: needed to keep bridge-service.ts under
  oxlint max-lines (it was 298 raw before this build).
- Codex HIGH finding (pause flip during await) folded in per coordinator.
- `dispatch-server.ts` still fails `max-lines` (pre-existing: 324 counted before, 336 now). Fixing
  needs a file split; left as-is.
- `voice-conductor/imessage-bridge.ts:47` has the same substring-LIKE identity (#14 second site);
  not in this build's file list, belongs to the Voice Conductor build that owns that file.
- Residual (#13): `bridge-config.ts` `persistConfig` swallows write errors (owned by the #15 build,
  lines 70-82). If that write fails, the in-memory watermark still prevents re-typing this session,
  but a restart could replay. Not changed here to avoid colliding with that build.

## Decisions for Carson
- "Explicit target" = the focused terminal, pinned at receipt, must be running an agent that is
  not on a permission prompt. No per-message terminal-addressing syntax was added. Commands to an
  idle shell are refused with an iMessage explaining why.
- Delivery is at-most-once: a message whose handling crashes is skipped, never retried.

## Lessons
- `runtime.sendTerminal(handle, action, { beforeWrite })` already rechecks before each chunk and
  before Enter; reuse it rather than re-implementing two-phase guarded sends.
- zsh: expand a file list with an array (`"${F[@]}"`), not an unquoted string.

## Review round 1 (coordinator findings)
- **F1 [high]** exact match broke a bare 10-digit US `selfHandle` (chat.db stores `+1XXXXXXXXXX`).
  New `imessage-bridge/self-handle-spellings.ts` builds the exact candidate set: emails lower-cased;
  phones by digits: 10 digits or 11 starting with 1 → `+1N`, `1N`, `N`; otherwise `+D`, `D`; plus
  the trimmed original. SQL compares `lower(chat_identifier)` / `lower(handle.id)` with
  `IN (SELECT value FROM json_each(?))`: exact only, never LIKE. Group exclusion kept. Split into its
  own file for max-lines. No other place in the bridge compares the configured handle
  (dispatch-server `knownHandle` compares terminal handles, unrelated).
  Tests: configured `5551234567`, `+15551234567`, `15551234567`, `(555) 123-4567`, `+1 555-123-4567`
  each match only the E.164 self chat and its unlinked row. They do not match a last-digit-different
  number, a superset number, another country code with the same national digits, or a group chat.
  `1234567` / `555123456` match nothing.
- **F2 [low]** handles starting with `-` are rejected, and `--` now precedes the argv values.
  Verified harmlessly (no Messages): `osascript -e 'on run argv' … -- -x` returns `-x` as item 1 and
  consumes `--` (count stays exact). Without it, `-e@x.com` is parsed as a `-e` script (syntax error).
- Mutation checks: M9 single-spelling lookup → 4 US-spelling tests fail; M10 drop leading-dash
  check → 2 tests fail; M11 drop `--` → 2 tests fail. All restored (diff-verified).
- Targeted: 5 files, 35 tests green. Typecheck exit 0. Lint clean on changed files (dispatch-server
  max-lines pre-existing, untouched this round).
