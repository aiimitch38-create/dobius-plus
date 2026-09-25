# REPAIR BUILD-039 — Speech and dictation lifecycle (Upstream)

Bugs: #84, #85, #92, #123, #86 (verify-only). Branch `stabilize/039-speech-dictation-lifecycle` from
`stabilize/integration` (480abdce). Builds on BUILD-037 (`use-audio-capture.ts` memoized controls); nothing of it is undone.

## Root causes (re-traced 2026-09-24 at 480abdce)

- **#84** `M/speech/openai-transcription-client.ts:81` `finish()` called `fetch(OPENAI_TRANSCRIPTION_URL, …)` with no
  signal and no timer, then `await response.json()`. A stalled upload/response never settled, so
  `SttService.stopDictation` (:340 `await session.finish()`) never returned and the renderer stayed in `stopping`
  ("Processing…"), where ⌘E is ignored (`DictationController.tsx:276`). The VPS client already had a 120 s bound.
- **#85** Both cloud sessions throw from `feedAudio` once 10 minutes are buffered
  (`openai-transcription-client.ts:55`, `vps-transcription-client.ts:57`). `SttService.feedAudio` lets it propagate,
  so the `speech:feedAudio` IPC rejects, but the renderer producer (`R/hooks/use-audio-capture.ts:179`) did
  `.catch(() => undefined)`. Every chunk after minute 10 was silently dropped while the UI still said Listening.
- **#92** `DictationController.startDictation` (:231) and `finishDictationSession` depend on the whole `settings`
  object, so any settings update (e.g. theme) creates new `startDictation`/`stopDictation`. They were deps of the
  listener effect in `use-hold-dictation-gesture.ts` (:190-201, with `keybindings`), whose cleanup calls
  `handleBlur()` → clears the insertion target, marks an intentional cancel and calls `stopDictation`. A theme change
  mid-hold therefore ended the dictation and threw away its target.
- **#123** `SttService.vpsEndpoint` (:39) was only changed by `setVpsEndpoint` (:59), which has no caller.
  `VoiceSettings.vpsSttEndpoint` (`shared/speech-types.ts:72`) was never read, so dictation always used
  `DEFAULT_VPS_STT_ENDPOINT` (`100.98.24.1:8823`).
- **#86 (verify-only, holds as REFUTED)** `onWorkerError` (`stt-service.ts:245`) handles the Worker `'error'` event,
  which Node emits for an uncaught worker exception and then ends the thread itself. Recoverable failures are posted as
  `{type:'error'}` messages (`stt-worker.ts:249,291`) and go through `onWorkerMessage`, keeping the worker. No code
  change; tests below pin the contract.

## Fix

- `openai-transcription-client.ts`: `AbortController` + `OPENAI_TRANSCRIPTION_TIMEOUT_MS` (120 s, same as VPS) around
  `fetch` **and** the body read. An abort (in fetch, or swallowed by the existing `json().catch`) becomes
  "OpenAI transcription timed out after 120 seconds". `SttService.stopDictation` already turns a `finish()` rejection
  into `error` + `stopped`, so the renderer leaves Processing and a retry works.
- `use-audio-capture.ts`: new optional `onFeedError` start option. A rejected live `feedAudio` calls it once per
  capture, and never for a capture that was already stopped/restarted (startRequest guard). Jarvis passes nothing, so
  its behavior is unchanged.
- `DictationController.tsx`: passes `onFeedError`; if the run/session is still current and Listening, it shows
  "Dictation stopped: <reason>" and runs the normal `finishDictationSession`, which transcribes and inserts the
  10 minutes already accepted. Choice: **stop visibly**, not segment (see Decisions).
- `use-hold-dictation-gesture.ts`: `startDictation`, `stopDictation` and `keybindings` are read through refs; the
  listener effect only re-runs when hold-relevant values change (`dictationMode`, `enabled`, whether a model is set).
  Unrelated settings updates no longer tear the listeners down mid-hold; release calls the latest `stopDictation`.
- `vps-transcription-client.ts`: `resolveVpsSttEndpoint(configured)`: configured value wins; missing/blank → default;
  malformed, non-http(s), or with credentials → clear error naming the value (never falls back to the old host).
- `stt-service.ts`: constructor takes `readVpsEndpoint` (default `() => undefined`); the VPS branch resolves it at
  each start. The dead `vpsEndpoint` field and uncalled `setVpsEndpoint` are removed.
- `speech-runtime-service.ts`: passes `() => store.getSettings().voice?.vpsSttEndpoint` (outside the spec's file list,
  2 lines; the only place the service is constructed).

## Tests

- `M/speech/openai-transcription-client.test.ts`: never-resolving fetch → pending at 119.999 s, timeout error at 120 s;
  never-finishing body → timeout error; 10-minute cap still transcribes the accepted 600 s.
- `M/speech/vps-transcription-client.test.ts`: `resolveVpsSttEndpoint` precedence, blank → default, malformed rejected.
- `M/speech/stt-service.test.ts`: configured endpoint reaches the request URL, and a change applies on the next start;
  malformed endpoint → start rejects, no fetch. #86: fatal `error`+`exit` → worker forgotten, next start spawns a
  fresh one; self-exit → forgotten, listeners removed; posted `{type:'error'}` → worker kept and reused.
- `M/speech/stt-worker-lifecycle.test.ts` (new): real `worker_threads` Worker that throws → `error` then `exit` (code 1,
  threadId -1) without terminate(): nulling on `'error'` cannot orphan a live thread.
- `R/hooks/use-audio-capture.test.tsx`: rejected live chunks → `onFeedError` once; a rejection after stop/restart is
  not reported to the new capture.
- `R/components/dictation/use-hold-dictation-gesture.test.tsx`: re-render mid-hold with a new settings object and new
  callbacks → no stop, target kept; release → latest stop once.
- `R/components/dictation/DictationController.test.tsx` (new): feed rejected at the cloud limit → toast
  "Dictation stopped: Cloud transcription is limited…", state `stopping`, `stopDictation('1')`; hold mode + theme
  change mid-hold → still listening, stop only on release.

Mutation checks (each seen failing, then restored and green):
- OpenAI fetch without `signal` → both #84 timeout tests fail. Without the post-read `aborted` check → body test fails.
- `VpsTranscriptionSession()` without the endpoint → configured-endpoint test fails. `resolveVpsSttEndpoint` returning
  the default for any value → 4 tests fail.
- `onWorkerExit` not clearing → self-exit #86 test fails.
- `onFeedError` not called → hook test and controller #85 test fail. Without the once flag → hook test fails. Without
  the startRequest guard → hook test fails.
- `use-hold-dictation-gesture.ts` restored to HEAD → both #92 tests fail.

## Deviations from EXECUTION-ORDER.md

- `M/speech/speech-runtime-service.ts` edited (outside the file list): it is the only constructor of `SttService`, so the
  setting cannot reach the service without it.
- #84 "owner cancellation": no new cancel IPC was added (no caller exists and ⌘E is ignored while stopping by design).
  The timeout bounds Processing; a window close during finish is already guarded by `window.isDestroyed()` in the sink.
- #85 stops visibly instead of segmenting. Segmenting needs overlapping cloud requests and ordered finals, a larger
  change for an Upstream file; stopping transcribes and inserts every accepted chunk and tells the user.
- `DictationController.tsx` itself was not changed for #92: fixing the gesture hook's effect deps is the root fix
  (the hook owned the teardown); the controller's callbacks can keep changing identity safely.

## Decisions for Carson

- Missing `vpsSttEndpoint` still defaults to `http://100.98.24.1:8823` (his own server; there is no Settings field
  for it yet). A set-but-malformed value fails loudly instead.
- At 10 minutes cloud dictation stops and inserts what it has (no automatic continuation).

## Rollback

Revert the commit. No data or settings format changes.

## Lessons

- In zsh a command stored in `$V` is not word-split; wrap it in a function (`V() { npx vitest … "$@"; }`).
- In a capture-hook test, a second `start()` without `stop()` is a no-op (`isCapturingRef`), so a "restarted
  capture" assertion silently tested the first capture until `stop()` was added.

## Verification

- `pnpm run typecheck` exit 0.
- oxlint + react-doctor config: clean on every changed file.
- Targeted vitest: `src/main/speech/` (14 files) and `src/renderer/src/hooks` + `src/renderer/src/components/dictation`
  all green. Full suite: deferred to the coordinator.
