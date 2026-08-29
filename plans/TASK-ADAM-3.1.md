# TASK-ADAM-3.1 — Proactive engine

Adam speaks unprompted when a job actually finishes. This is the feature that
changes what he is: Mark LI's version guesses from time-of-day because it has no
signals; Dobius+ has real ones in `terminal-history/*/output.log`.

## Algorithm gate

1. **QUESTION.**
   - *Does the completion-marker gate need to exist?* Yes, and it is the whole
     feature. `AUTONOMOUS-BUILD.md` is right that silence is not completion: an
     agent at a permission prompt is quiet, a REPL is quiet, and at launch every
     terminal is quiet. Without the marker the thing fires constantly and gets
     turned off in a day. Kept, non-negotiable.
   - *Does the 10-minute staleness ceiling do enough on its own?* **No — and
     this is the one place the spec is too loose.** A job that finished five
     minutes before launch passes all four gates, so opening the app announces
     something Carson already watched finish. Added: the watcher **primes** on
     its first tick — it records every terminal it can see as already announced
     and says nothing. Only completions observed *while running* are spoken.
     Three lines, and it removes the most obnoxious possible first impression.
   - *Does the cooldown need to be global?* Yes. Four builds finishing together
     must produce one message. Per-terminal cooldown would produce four.
2. **DELETE.**
   - **The file watcher.** The plan says watch `terminal-history/*/output.log`;
     that means chokidar, debouncing, and handle churn over directories that are
     created and destroyed with terminals. But the trigger *requires 30 seconds
     of silence*, so sub-second precision is worth exactly nothing. A 15-second
     `setInterval` re-using `readRecentTerminalActivity` — which already stats
     the files and cleans the tails — replaces all of it. This is the single
     biggest cut in the task.
   - **A settings-change subscription.** The watcher re-reads
     `store.getSettings().voice` every tick, so the toggle takes effect within
     15 seconds with no event wiring at all.
   - **Per-terminal cooldown state, retry logic, a spoken-message queue.** One
     global `lastSpokeAt` number.
3. **SIMPLIFY.** All four gates live in ONE pure function over a plain input
   object. No fs, no timers, no clock inside it. The watcher class is then a
   ~40-line impure shell: poll, call the function, speak. Reuse
   `readRecentTerminalActivity` and `service.speak` rather than adding a second
   reader or a second TTS path.

## What

**New `dobius/src/main/jarvis/proactive-watcher.ts`.**

*Pure core (all of the logic, all of the tests):*

- `classifyOutcome(tail): 'failed' | 'passed' | 'finished' | null` — `null`
  means no completion marker, which means say nothing. Markers per the build
  file: `error, failed, exit code, ✗, FAIL, passed, ✓, built in, Done`.
  Failure wins when both appear, because `1 failed | 29 passed` is a failure.
  - **Neutralisation pass first.** `exit code 0`, `0 errors`, `no errors`,
    `0 failed` are stripped before scanning. Every one of those strings was
    produced by this repo's own tooling during this build; without the strip,
    a clean `tsc` run is announced as a failure. Announcing a pass as a failure
    is exactly the "intolerable if it is wrong" risk the design names.
- `decideProactive(input): ProactiveDecision` — the four gates, in one place:
  1. a completion marker is present (`classifyOutcome` is not null)
  2. quiet for ≥ 30s
  3. last activity within 10 minutes
  4. global cooldown of 5 minutes since the last utterance

  Plus enabled/quiet-hours, and the already-announced set. Returns
  `{ text, announced }` or `null`. `now` is a parameter, never `Date.now()`.
- `isQuietHours(now, from, to)` — handles the midnight wrap (22 → 8).

*Impure shell:* `ProactiveWatcher` with `start()` / `stop()`, a 15s interval, a
`primed` flag, and an injected clock and speak function.

**Settings (`speech-types.ts`, `JarvisSettingsSection.tsx`):**
`jarvisProactive?: boolean` (**default OFF**), `jarvisProactiveQuietFrom?: number`,
`jarvisProactiveQuietTo?: number` (hours, default 22 → 8). All optional, read
with `=== true` like `jarvisWakeWord`, so no config-manager change is needed and
the task stays inside the blast radius.

**Wiring:** started from `registerJarvisIpcHandlers` in `jarvis-ipc.ts`, speaking
through `service.speak` — plain TTS, which bills per character, rather than
opening an agent call, which bills per minute.

## Test

- `classifyOutcome` over sample tails: a vitest failure line, a vitest pass line,
  `✓ built in 2m 2s`, a bare prompt with no marker (→ null), and each
  neutralisation case (`exit code 0`, `0 errors`, `no errors` must NOT be failures)
- each of the four gates independently, with an injected clock:
  - no marker → silent even when everything else passes
  - active 5s ago → silent (silence gate)
  - active 40 minutes ago → silent (staleness ceiling)
  - spoke 1 minute ago → silent (cooldown)
- **four simultaneous completions yield exactly one utterance** — the specific
  regression the build file calls out
- the same completion is not announced twice on a later tick
- quiet hours, including the midnight wrap
- disabled by default: an input with no `jarvisProactive` says nothing
- the watcher primes on first tick and speaks nothing

## Risks

- **Talking when wrong is worse than staying silent.** Mitigated by the marker
  gate, the neutralisation pass, default-off, the global cooldown, and quiet
  hours.
- **A 15s poll over a directory of logs.** `readRecentTerminalActivity` already
  runs this exact read on every agent connect; capped at 10 terminals and an
  8KB tail each.

## Estimate

~180 lines of source, ~200 of test, plus settings and wiring.
