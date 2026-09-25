# REPAIR BUILD-033 — Conductor approvals (#9 #10 #11 #121 X3 X5)

## Root causes
- **#9 (A2)** The conductor prompt (`conductor-system-prompt.ts` Phase 4/5) makes `dobius-confirm`
  the gate for pushes, Asana posts and deletes, but nothing installed a working `dobius-confirm`.
  `voice-conductor/cli-install.ts` never wrote one; `dobius-cli/install-clis.ts` turned a legacy
  copy into the generic "command was retired" stub (`exit 1`), and a fresh install has no command
  at all. The prompt only said "proceed if Carson's answer matches yes", so a model running with
  bypass saw "retired"/"not found" and could decide to carry on.
- **#10 (F3)** `index.ts` passed `process.env.DOBIUS_IMESSAGE_HANDLE ?? ''` to the conductor. The
  packaged app never has that env var, so the handle was empty and every ask/spawn confirmation
  failed with a generic error. The handle already has a Settings home: the iMessage bridge
  "your handle" (`imessage-bridge.json` `selfHandle`).
- **#11 (#5)** `voice-conductor/imessage-bridge.ts` `ask()` returned the first non-echo row newer
  than the baseline in `handle.id = ? OR chat.guid LIKE %handle%`. Any message (an unrelated
  self-note, a second concurrent question's reply, a late reply, a longer number or group chat
  containing the handle) was taken as the answer. `/spawn` then accepted `^(y|yes|ok|sure)\b`,
  so "yes but not now" spawned.
- **#14 second site (brief EXTRA SCOPE)** the same substring-LIKE identity at `imessage-bridge.ts:47`.
- **#121 (F6/E11)** `service.ts:27-28` hard-coded the build/review lane gids; the Settings values
  (`asana-config.json` `myGid`/`reviewGid`, the owner the Asana intake already uses) were ignored.
- **X3** stale comment in `service.ts` said agent spawning "fails loudly"; it is wired.
- **X5** `dobius-ask` help said "Ask Sam" but it texts Carson's handle.

## Fix
- `imessage-bridge.ts`
  - Config takes `resolveHandle()` instead of a fixed string. It is read at every use, so a Settings
    change applies without a restart. `unavailableReason()` returns the exact problem (macOS only,
    handle missing, handle invalid via the BUILD-032 `isValidImessageHandle`). `isAvailable()` is
    `unavailableReason() === null`. send/ask throw that reason before opening chat.db or sending.
  - `ask()` issues a fresh 4-digit reply code (never reused in the session until 5000 issued),
    sends `question + Reply "<code> <your answer>" within N min`, and accepts only a row that
    starts with that code (`parseCodedReply`). The answer is the text after the code.
  - SQL reuses BUILD-032 `selfHandleSpellings` (exact, case-insensitive `json_each`, never LIKE):
    exact 1:1 chat (no `;+;` group), and the row is from the handle itself or from this Apple ID
    (`is_from_me`, the self-thread case). Unlinked rows need an exact handle match.
  - Rows whose text equals something this bridge sent (questions and notifications) are skipped,
    so the conductor can't approve itself by sending "<code> yes".
  - A scan cursor advances over rows already seen, so more than 50 unrelated rows can't hide the reply.
- `conductor-cli-routing.ts`: new `requestImessageApproval(imessage, action)`. No channel → deny
  with the reason, `''` (timeout) → deny, the whole answer must be one approval word
  (`yes|y|ok|okay|approve|approved|confirm` with optional `.`/`!`), else deny. New `/confirm` route
  (action 1-500 chars). `/spawn` uses the same helper. `/ask` returns the unavailable reason
  instead of a silent empty answer.
- `cli-install.ts` (conductor CLIs, v1 → v2): new `dobius-confirm` script. It exits 0 and prints
  APPROVED only when the server JSON has `approved === true`. Denial, curl failure, a non-JSON body
  or `approved:"true"` all print DENIED and exit 1 (token unreadable exits 2 as before).
  `dobius-ask` help: "Ask the iMessage handle set in Settings (iMessage bridge)" (X5). It now
  prints `(error: ...)` when the server refuses.
- `dobius-cli/install-clis.ts`: a retired `dobius-confirm`/`dobius-ask` now reads
  `DENIED: no approval channel (the Voice Conductor is not running). Do not proceed.` It also
  rewrites its own earlier retired stubs (`# dobius-cli v` + retired message), which it used to
  skip. The conductor's real scripts (`# dobius-conductor-cli`, port 8422) are never touched.
- `conductor-system-prompt.ts`: tool list adds `dobius-confirm`. `dobius-ask` is "NOT an approval".
  The Phase 4 gate says to proceed only on exit 0 + APPROVED; missing, failed, timed out or DENIED
  means NO. Do not retry another way. One approval covers only the action it named.
- New `conductor-settings.ts`: `conductorImessageHandle()` (iMessage bridge `selfHandle`),
  `conductorLaneAssignees()` (asana-config `myGid`/`reviewGid`), and
  `createSettingsLaneAsanaQueue()`, which re-reads lanes on every fetch.
- `service.ts`: hard-coded gids removed; uses the two helpers. `syncVoiceConductorFromSettings`
  no longer takes a handle; it logs `iMessage approvals will be denied: <reason>` at start when
  the handle is missing (no handle value logged). X3 comment corrected.
- `index.ts`: env handle read removed; wiring passes only settings + runtime.

## Tests
- `voice-conductor/imessage-bridge.test.ts` (extended; `sendImessage` mocked, temp-file chat.db,
  `crypto.randomInt` spied for fixed codes):
  - #10: missing handle is reported and refused before db/send; invalid handle is reported;
    the handle is read live.
  - #11: question carries its code to the configured handle. Two concurrent asks each get their
    own coded reply (replies arrive in reverse order). Uncoded "yes", uncoded self-notes and the
    question echo are ignored. A coded message the bridge sent itself is ignored. The right code
    is rejected from a longer number's chat, a group chat, another person's chat, another sender's
    row in the handle's chat, and an unlinked row from another sender. A bare 10-digit handle
    matches the E.164 chat, from the handle or from is_from_me. A late reply to an expired
    question does not answer the next one, and a repeated code offer is skipped.
  - `parseCodedReply` unit cases.
- `voice-conductor/conductor-approvals.test.ts` (new):
  - approval words vs hedged answers; timeout and missing handle deny (ask not called);
  - `/confirm` yes vs hedged; empty action → 400, not approved; ask throws → 500, no `approved`;
  - `/spawn` "yes but not now" doesn't spawn; `/ask` shows the missing-handle reason.
  - The installed `dobius-confirm` script runs under bash with a stub `curl` on PATH (no network):
    approved → exit 0 APPROVED; denied → exit 1; curl failure / error body / HTML /
    `"approved":"true"` → non-zero DENIED.
  - System prompt fail-closed wording; X5 help text.
- `voice-conductor/conductor-settings.test.ts` (new): #121 lanes come from Settings and change
  between two fetches without rebuilding the queue (a task for the old hard-coded gid is
  dropped); #10 handle from the bridge setting.
- `dobius-cli/install-clis.test.ts` (extended): legacy `dobius-confirm` → DENIED stub; the earlier
  generic retired stub is upgraded; the conductor's own `dobius-confirm` is left unchanged.
- `voice-conductor/cli-server.test.ts`: fake bridge gains `unavailableReason`.
- Targeted: `src/main/voice-conductor src/main/dobius-cli src/main/imessage-bridge`: 15 files,
  108 tests green.

## Mutation checks (script at stabilize-run/033/mut.py; each file restored and byte-compared)
- M1 LIKE/substring identity back in the reply SQL → wrong-sender/chat test fails.
- M2 accept any text without the code → 4 tests fail (concurrency, unrelated, late, self).
- M3 drop the outbound-text exclusion → self-approval test fails.
- M4 allow code reuse → late-reply test fails.
- M5 old loose `^(y|yes|ok|sure)\b` regex → 4 approval tests fail.
- M6 script exits 0 on DENIED → 2 script tests fail.
- M7 generic retired stub for dobius-confirm → 2 install-clis tests fail.
- M8 don't upgrade own old stubs → 2 install-clis tests fail.
- M9 hard-coded lanes → #121 test fails.
- M10 ignore a missing handle → #10 test fails.
- M11 `/ask` without the unavailable check → test fails.
- M12 prompt fail-closed sentence removed → prompt test fails.

## Rollback
Revert the commit. No data format change. Installed scripts: the conductor rewrites its CLIs
when the content changes (marker v2). The old retired stub text is still recognized.

## Deviations from EXECUTION-ORDER.md
- Files beyond the list: `voice-conductor/cli-install.ts` (the real `dobius-confirm` and the X5
  help text live here, not in `dobius-cli/install-clis.ts`), `conductor-cli-routing.ts` (the
  `/confirm` route and shared approval helper), `types.ts` (`unavailableReason`), new
  `conductor-settings.ts` (Settings readers, kept out of `service.ts` so they can be unit-tested
  without Electron), and the fake in `cli-server.test.ts`.
- "Host-enforced" (#9 matrix row) is as far as the host can reach. Approval is a host-side iMessage
  round-trip bound to one action text, one code, the exact chat/sender and a 5-minute expiry.
  `dobius-confirm` exits 0 only on that approval. The conductor still has Bash, so the host can't
  stop it from running a command without calling dobius-confirm. That needs a tool-permission
  hook (BUILD-007 profiles), which is out of this build's scope.
- #121 matrix also names "regular intake": the Asana intake already reads `asana-config`. The
  conductor now reads the same owner, so no intake change was needed.
- `DOBIUS_IMESSAGE_HANDLE` is no longer read (single Settings source).

## Decisions for Carson
- Reply syntax: every conductor iMessage question ends `Reply "<4-digit code> <your answer>"`.
  For approvals the answer must be exactly yes/y/ok/okay/approve/approved/confirm.
- The conductor's handle is the iMessage bridge "your handle" setting (the same one the `d:`
  bridge uses). The env var is ignored.
- A retired `dobius-ask` also reads as DENIED (it used to say "retired").

## Lessons
- node:sqlite readers see rows another connection commits to a temp-file DB between polls. That
  makes a real polling test possible without a fake DB layer.
- Stub `curl` on PATH to test a generated shell CLI end to end with no network.
