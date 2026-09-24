# REPAIR BUILD-019 — Jarvis self-edit concurrency and undo (#38 #39)

C2 is unchanged: Jarvis still proposes and applies its own approved edits. BUILD-006's path
policy and the `apply()` re-validation are kept (now shared by apply and undo via `recheckPath`).

## Root cause
- **#38** `propose()` (`src/main/jarvis/self-edit.ts`) captured `oldContent` for the review diff
  but `apply()` never compared it with the file on disk. Anything written to the file while the
  user reviewed (hand edit, another agent, git checkout) was silently overwritten; the backup was
  copied from the NEW on-disk bytes, so the reviewed diff no longer described what was written.
- **#39** `SelfEditProposal.appliedBackupPath` and the `apply()` doc comment promised a
  "one-step undo", but no restore operation existed anywhere (no store method, no IPC, no
  preload API, no voice tool). The backup file was write-only.

## Fix
- New `src/main/jarvis/self-edit-snapshot.ts`: `readSnapshot(path)` reads raw bytes with
  `O_NOFOLLOW` (ENOENT → `{exists:false}`), `snapshotDigest()` (sha256, null = no file),
  `bytesDigest()`. Raw bytes, not utf-8 text, so a change that decodes to the same string
  (invalid byte sequences) is still detected.
- `propose()` stores `originalDigest` of the bytes it read (the same read that produces
  `oldContent`).
- `apply()`: after the BUILD-006 path re-check, reads the current bytes; if their digest differs
  from `originalDigest` (including "file appeared" / "file vanished") it returns
  `{ok:false, conflict:true, error}` and writes nothing (no backup, no target). The proposal stays
  pending so the review window keeps showing it and the error; the user discards or Adam
  re-proposes (propose reads fresh bytes, i.e. a fresh diff). The backup is now written from the
  exact verified bytes with flag `wx` (never overwrites an older backup) instead of
  `copyFileSync` of whatever is on disk at that moment.
- `apply()` records an `AppliedEdit` (path, backup path or null if the edit created the file,
  original digest, digest of the written bytes).
- New `undo(id)`: path re-check; current bytes must equal the applied bytes, else
  `{ok:false, conflict:true}` and nothing changes (error names the backup path); backup bytes must
  still match `originalDigest`, else refused; then writes the backup bytes back with the existing
  `O_NOFOLLOW` writer, or removes the file if the edit created it (safe: its bytes were just
  verified to be exactly what the edit wrote). The record is dropped after success, so undo is one
  step.
- `jarvis-ipc.ts`: new `jarvis:undoSelfEdit` handler → `selfEdits.undo(id)`.
- `preload/index.ts` + `api-types.ts`: `undoSelfEdit(id)`; `applySelfEdit`'s result type gains the
  optional `conflict: true`.
- `use-voice-agent.ts`: client tool `undo_code_change({proposal_id})`, answering
  `Undid the change to …` / `Not undone: <error>` (same shape as `apply_code_change`).
- UI: no change needed. `SelfEditView.approve()` already shows `result.error` next to the
  buttons and keeps the proposal on screen; apply's conflict message lands there.

## Residual race (documented, not fixed)
Between the digest check and the write there is a microsecond window (Node has no
compare-and-swap write). This shrinks the window from "the whole review" to one syscall pair.

## Files
- `src/main/jarvis/self-edit.ts`
- `src/main/jarvis/self-edit-snapshot.ts` (new)
- `src/main/jarvis/jarvis-ipc.ts`
- `src/preload/index.ts`, `src/preload/api-types.ts`
- `src/renderer/src/components/jarvis/use-voice-agent.ts`
- `src/main/jarvis/self-edit.test.ts`

## Tests (`src/main/jarvis/self-edit.test.ts`, describe "concurrency and undo")
- External edit between propose and apply → `conflict`, file bytes untouched, no backup dir,
  proposal still pending.
- Same-length change that differs only in invalid utf-8 bytes → conflict.
- New-file proposal, file created meanwhile → conflict, other writer's file kept.
- Apply then undo restores exact bytes (binary with 0xff, CRLF, NUL); second undo refused with
  "no applied change".
- Undo of a file-creating edit removes the file.
- Undo after a later edit → conflict, later edit kept.
- Undo of a created file edited afterwards → conflict, file kept.
- Tampered backup → undo refused, file unchanged.
- Existing backup with the same name → apply refused, old backup and target untouched.

Mutation checks (each failed the file, then restored; final 37/37 green):
M1 drop apply digest check (3 fail); M2 drop undo digest check (2); M3 undo writes decoded
string (1); M4 backup flag `w` (1); M5 drop backup digest check (1); M6 digest of decoded text
(1); M7 undo of created file keeps it (1); M8 keep the record after undo (survived at first:
second undo was refused by the conflict check instead; test tightened to assert the
"no applied change" error, then M8 fails 1).

## Deviations from EXECUTION-ORDER.md
- Touches `src/preload/index.ts`, `src/preload/api-types.ts` and
  `src/renderer/src/components/jarvis/use-voice-agent.ts` (outside the spec's list): without them
  the new IPC handler is unreachable and #39's undo would still not exist for the user.
- New module `self-edit-snapshot.ts` (byte snapshot helpers) to keep self-edit.ts small.

## Decisions for Carson
- Undo is by voice only (`undo_code_change`, keyed by the proposal id Adam already has). The
  review window closes on apply, so no Undo button was added (no UI redesign). The ElevenLabs
  agent must list `undo_code_change` as a client tool (with a `proposal_id` string parameter)
  before Adam can call it.
- Undo records live in memory: after an app restart, undo is refused, and the `.bak` in
  `userData/self-edit-backups` is the manual fallback (same as before).
- A conflicted proposal stays pending (visible) rather than being auto-discarded.
