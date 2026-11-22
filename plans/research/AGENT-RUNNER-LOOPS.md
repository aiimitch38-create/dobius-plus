# Agent runner loops: check, retry, learn, grade (plan 2.3, 4.1, 4.2, 4.3)

Design pass only. No app code changed. Written 2026-11-22 on branch `wb/plan2-runner`.

Read first: the audit box at the top of `plans/WORKSTATION-BUILD-PLAN.md`, its rows 2.3 / 4.1 / 4.2 / 4.3,
`plans/research/IRIS-PLAN-AUDIT-20261121.md`, `plans/research/EVENT-LOG-AND-RUN-GATE.md`,
`plans/research/AGENT-ACTIVITY-FEED.md`.

Paths are relative to `dobius/src/` unless they start with `plans/`. Every line number below was read in this
worktree on 2026-11-22.

## Plain-English terms

- **Run** (one job handed to an agent, from prompt to final answer).
- **SDK** (the Claude Agent SDK: the library the app uses to start an agent without a terminal).
- **Postcheck** (a command the app runs itself after the agent says "done", for example the tests. Exit code 0 means pass).
- **Retry** (starting the agent once more, with the failed check's output as the new prompt).
- **Hook point** (a line in a shared file where new behaviour is plugged in).
- **Settle** (the moment a run has fully ended and given back its slot, so a new run may start).
- **Callback** (a function a caller hands in, to be called later, for example "tell me when the run ends").
- **Session** (the agent's saved conversation. Resuming it means the agent still remembers what it just did).
- **Outward action** (anything that leaves this Mac and cannot be taken back: send, post, push, deploy, pay).
- **Grader** (a second agent that only reads the work and answers pass, or lists what is missing).
- **Journal** (the app's append-only event file, `agent-events.ndjson`).

## Short version

1. One new file owns everything that happens after a run ends. `agent-runner.ts` gets one hook, used in two places.
2. The check runs at settle. A retry is a normal new run that resumes the same session.
3. Default is one retry. A run that used any outward tool is never retried.
4. Runs with no check behave exactly as today. All 11 callers are in that group right now.
5. The audit's doubt is settled: SDK runs do NOT read `CLAUDE.local.md`. Most of them DO read user settings.

## (a) How a run flows today

### `main/agents/agent-runner.ts` (607 lines)

Start, in `startAgentRun` (`:306`):

| Step | Lines | What happens |
|---|---|---|
| Pause switch | `:314-315` | `origin` defaults to `'agent-run'`; `assertExecutionAdmitted(origin)` refuses if the crew is paused |
| Slot limit | `:316-318`, `:331-332` | at most 8 runs at once (`MAX_CONCURRENT_RUNS`, `:64`) |
| Session claim | `:333-339` | `sessionKey` defaults to `'default'`; a busy key means "start fresh, do not resume" |
| Codex branch | `:342-375` | builds the run record (`:351-360`), wraps callbacks (`:372`), starts the Codex process |
| Sign-in | `:376-380` | prepares the Claude account, then checks the pause switch a second time |
| Folder + brief | `:382-383` | resolves the folder; refreshes `CLAUDE.local.md` without waiting for it (`void`) |
| System prompt | `:385` | `buildSystemPrompt(agent)`: instructions, soul, role, playbook, rules, memory, recent progress log |
| Resume | `:386-393` | resumes the saved session only if the key is free and the folder is the same |
| Options | `:407-434` | model, tools, 100 turns (`:419`), budget $2 or $1 for channel runs (`:422-423`, `:70`), settings sources (`:433`) |
| Guards | `:448-457` | hard-rail hooks and the sandbox policy |
| Watched or not | `:463-476` | only an Agents-page manual run can ask a person; every other run has its prompts denied |
| Record + go | `:477-501` | run record with `context ?? { correlationId: runId }` (`:482`), `query()` (`:490`), `consumeRun` not awaited (`:493`), callbacks wrapped (`:500`) |
| Start failed | `:503-514` | gives back the slot and session, marks the run `error`, re-throws to the caller |

Stream and finish, in `consumeRun` (`:174`):

| Step | Lines | What happens |
|---|---|---|
| Read messages | `:190-198` | each SDK message becomes run events through `broadcastRunEvent` |
| Result arrives | `:199-222` | caller's `onResult` fires (`:201`); run becomes `success` or `error` with summary, turns, cost (`:207-216`); a notification is written (`:219`) |
| No result | `:224-242` | stream ended early: `error`, or `cancelled` if a person stopped it |
| Resume failed | `:244-269` | the ONLY retry today: if resuming threw before the session started, try once with a fresh session |
| Other error | `:270-286` | `error` plus `onRunEnded` |
| Settle | `:287-302` | deny waiting prompts, add one line to the agent's progress log (`:293`), release session and slot (`:297-299`), then `callbacks.onSettled()` (`:301`) |

Codex runs finish in `finishCodexRun` (`:547-574`): same steps, progress log at `:568`, `onSettled` at `:573`.

The callbacks are made safe in `main/agents/agent-run-end-callbacks.ts:31-69`: each fires at most once and can never throw into the runner.
The comment at `agent-runner.ts:131-133` matters for this design: a caller that starts the next turn from `onResult` finds the session still busy. `onSettled` is the first safe moment.

### `main/automations/run-lifecycle.ts` (146 lines)

This is a different kind of run. Automations launch an agent in a terminal. They do not call `startAgentRun`.

- `main/automations/service.ts:144` runs the **precheck** (a command that decides whether the automation should run at all) before launch.
- `service.ts:296-301` launches. `service.ts:315-321` hands the launch's `completion` promise to `settleHeadlessCompletion`.
- `run-lifecycle.ts:70-99` `settleHeadlessCompletion`: when the agent finishes, it records the status, the precheck result and an output snapshot. A failure becomes `dispatch_failed`.
- `run-lifecycle.ts:31-65` `finalizeAutomationRunResult`: the first final result wins; it then collects usage and sends the notification.
- `run-lifecycle.ts:105-116`: after a restart, a half-launched run is closed as interrupted, never launched twice.

Things that already exist and get reused:

- `main/automations/precheck-runner.ts:261` `runAutomationPrecheck`: runs a shell command in a folder with a timeout and returns exit code plus the tail of the output.
- `shared/automation-precheck.ts:3-5`: 60 s default timeout, 600 s maximum, 4,000 characters of output kept.
- `main/automations/loop-stop-check.ts:36-43` already uses that runner as an "after the agent stops" check. It is the closest thing to a postcheck in the app today.
- Verified by search: the word "postcheck" appears nowhere in `dobius/src`.

## (b) One design for all four items

### The idea

A new file, `main/agents/agent-run-loop.ts`, owns "what happens after a run ends".
It plugs into the runner through the callbacks the runner already has.

The runner already calls `onSettled` at the right moment for both engines (`:301` and `:573`).
So the new file wraps the callbacks, and its own `onSettled` becomes the place where the after-run steps start.

### The only edits to `agent-runner.ts`

1. `AgentRunOptions` (`:98-136`) gains three optional fields: `postcheck`, `grade`, and `loop` (internal: attempt number, first run's id, budget left).
2. The two places that wrap callbacks, `:372` (Codex) and `:500` (Claude), change from `guardRunEndCallbacks(args.options)` to:

```ts
attachRunLoop({ runId, agent, cwd: resolvedCwd, startArgs: args, restart: startAgentRun })
```

That is about 12 changed lines, made once, in the first build task.
`restart: startAgentRun` is passed in as a value, so the new file never imports the runner (no circular import).
The stream loop (`:183-222`), the settle block (`:287-302`) and `finishCodexRun` stay untouched.
Items 4.1, 4.2 and 4.3 then add steps to the new file. They do not open `agent-runner.ts` again.

### What happens at settle

```
run settles (slot and session already released)
  1. cancelled?                      -> stop. No check, no retry, no lesson.
  2. no postcheck and no grade?      -> caller callbacks fired live, as today. Go to step 7.
  3. status error?                   -> Blocked. Go to step 6. (Out of turns or budget: a retry would only spend more.)
  4. run the postcheck command       -> record the result on the run and in the journal
       pass -> step 5
       fail -> may we retry? (rules below)
                 yes -> restart(...) with the failure as the prompt. This run's part ends here.
                 no  -> Blocked, or Needs review if an outward tool was used. Step 6.
  5. grade requested? (4.3)          -> start the grader run: read-only, fresh session
       pass -> Verified
       gaps -> same retry path as a failed check, with the named gaps as the prompt
  6. final: flush the caller's held callbacks (last attempt's result), write the outcome
  7. always-on steps, fire and forget:
       lesson write-back (4.2) if the run failed or was retried
       graph refresh (4.1) if the run succeeded and the repo's HEAD moved
```

### Where the postcheck runs

In the main process, at settle, in the run's folder, through the existing `runAutomationPrecheck` with a local target.
The command always comes from the caller (Carson's CLI flag or config). It is never taken from the agent's output.

### Where the retry re-enters

Through `startAgentRun` itself, as a normal new run. This is the key choice, because the retry then gets every existing guard for free:

- the pause switch (`:315`, `:380`), so Pause crew also stops retries;
- the 8-run limit, the budget cap, the hard rails and the sandbox;
- its own run record, events and notification.

The retry uses the same `sessionKey`, so `:386-393` resumes the session and the agent still knows what it built.
Its prompt is: the check command, its exit code, the last 4,000 characters of output, then "Fix the cause. Do not send, post, push, deploy or pay. End with one line starting `LESSON:`."
Its `context` copies the first run's `correlationId`, so all attempts share one thread in the journal.

May we retry? All of these must be true, and the rule lives in one pure function that is easy to test:

- attempts so far < the cap (default 2 runs in total, meaning one retry; hard ceiling 3);
- the engine is Claude (Codex runs report no tool events, so "no outward action" cannot be proven);
- the source is `manual` (never `channel`, `heartbeat`, `asana`, iMessage or voice: those runs ARE messages);
- every tool the attempt used is on a known-local list (see Risks);
- budget is left under the loop's ceiling;
- `checkExecutionAdmission('agent-run')` says the crew is not paused.

The loop learns which tools a run used by listening with `subscribeToAgentRunEvents` (`main/agents/agent-run-events.ts:12`).
`tool-use` events already carry the tool name and its input (`agent-run-events.ts:84-89`). No runner change is needed for that.

### What the caller sees

- A run with no `postcheck` and no `grade`: callbacks pass straight through. Nothing changes. That is all 11 callers today.
- A looped run: the caller's `onResult` / `onRunEnded` / `onSettled` are held until the loop is finished, then fired once with the last attempt's result. So a caller never posts two answers or starts its next turn in the middle of a retry.

### What gets recorded

On the run record (`AgentRun`, `shared/agents.ts:147-163`), all optional, so old records still load:

| Field | Meaning |
|---|---|
| `attempt` | 1, 2, ... |
| `rootRunId` | the first run of the loop |
| `postcheck` | the check result, in the existing `AutomationPrecheckResult` shape (command, exit code, output tail, times) |
| `outcome` | `verified`, `blocked` or `needs-review`. Missing means "no check" or "app quit mid-loop" |
| `loopCostUsd` | total spend across attempts, on the last run |

`AgentRunStatus` (`shared/agents.ts:110`) is NOT changed. Many screens read it.

In the journal: one `system` event per step through `broadcastRunEvent`, the single writer named in `EVENT-LOG-AND-RUN-GATE.md` finding 2.
Fixed text prefixes: `postcheck: passed`, `postcheck: failed exit 1, retry 1 of 1`, `loop: blocked after 2 attempts`, `grader: pass`, `lesson: recorded`, `graph: refreshed`.
The event `kind` list is not extended, so the feed (8.10) and ADAM delivery need no change.

In the agent's files:

- progress log: unchanged, one line per attempt (`agent-runner.ts:293`);
- memory: one lesson line (4.2), see task 4.

### How it ties into the event log and the run gate

- **Event log (2.2 / 8.1).** The postcheck result is the first real "proof of done" record the app produces. It goes through the one writer and carries the run's `context`. When 2.2 lands, it reads these events and needs no second record book.
- **Run gate (8.11).** None of the 11 `startAgentRun` callers pass a task context today (verified in the gate doc, finding 5), so this design does not depend on one. A check is opt-in per run. Every retry and every grader run goes through `startAgentRun`, so when the gate's task-context check is added at `:315` it covers them too. The loop copies the first run's `context` forward, so a retry of a managed run stays managed.
- **Later, not now.** Once callers fill in `adamTaskId` (gate doc task 4), `outcome: blocked` can move the task's card to Blocked. Today there is no card to move, so Blocked is a run outcome plus a notification.
- **Origin.** A retry keeps the caller's `origin`, so a watched Agents-page run stays watched. Because `agents-page` skips the pause switch (`execution-gate.ts:31-33`), the loop makes its own pause check before each retry.

### How each item fits

| Item | Where it lives | Runner edits |
|---|---|---|
| 2.3 postcheck + retry | steps 3, 4, 6 | the one hook (task 2) |
| 4.2 lesson write-back | step 7, new `agent-run-lesson.ts` | none |
| 4.3 grader | step 5, new `agent-run-grader.ts` | none |
| 4.1 graph refresh | step 7, new `agent-run-graph-refresh.ts` | none |

## (c) Build sequence

Build in this order, one at a time (audit rule: these items never run in parallel).
Sizes: S = under half a day, M = one to two days.
Every task: take a test baseline first, then run `pnpm run typecheck:node` and the named tests from `dobius/`.
A task that touches `shared/` or the CLI also runs `typecheck:web` and `typecheck:cli`.

| # | Task | Size | Files | The test that proves it |
|---|---|---|---|---|
| 1 | **Rules as pure functions.** Types, `decideNextStep`, `isLocalOnlyToolUse`, `buildRetryPrompt`, `parseLessonLine`, loop budget maths. New optional fields on `AgentRun`. No main-process code. | S | new `shared/agent-run-loop.ts`, new `shared/agent-run-loop.test.ts`, edit `shared/agents.ts` | Table test: pass gives done; fail on attempt 1 gives retry; fail on attempt 2 gives blocked; any outward or unknown tool gives needs-review; Codex, channel, cancelled and no-budget give no retry |
| 2 | **The hook, postcheck and retry (2.3).** `attachRunLoop`, held callbacks, tool listener, retry through `restart`. | M | new `main/agents/agent-run-loop.ts`, new `main/agents/agent-runner-postcheck-retry.test.ts`, edit `main/agents/agent-runner.ts` (options type, `:372`, `:500`) | Using the mocks from `agent-runner-workspace-brief.test.ts`: check exits 1 then 0, so `query` is called exactly twice, the second prompt contains the check output, the caller's `onResult` fires once. Check exits 1 twice: exactly 2 runs, outcome `blocked`. Fake `tool-use` of a send tool: 1 run, `needs-review`. No postcheck: callback order identical to today. The 10 existing `agent-runner-*.test.ts` files stay green. |
| 3 | **A way to ask for a check.** `agent.run` accepts `postcheck`; the CLI gets `--check "<command>"` and `--check-timeout`. | S | `main/runtime/rpc/methods/custom-agents.ts` (`:54-70`, `:147-165`), `cli/specs/custom-agents.ts`, `cli/handlers/custom-agents.ts` | Schema test: the command is trimmed and capped, the timeout clamped to 600 s. One live run in the isolated test copy: `dobius agent run --check "exit 1"` shows two runs and outcome `blocked`. |
| 4 | **Lesson write-back (4.2).** After a failed or retried loop, one line into the agent's `memory.md` under a "Lessons" heading. Deduped, 160 characters per line, newest 20 kept. | S-M | new `main/agents/agent-run-lesson.ts` + test, edit `main/agents/agent-identity-files.ts` (new `appendAgentLesson` beside `:195`), one line in `agent-run-loop.ts` | Same lesson twice gives one line; the 21st lesson drops the oldest; a clean first-try pass writes nothing; a write error is logged and does not change the run's outcome |
| 5 | **Grader (4.3).** Opt-in `grade`. Read-only tools (`Read`, `Grep`, `Glob`), fresh session, answer forced into `{ pass, gaps[] }`, 15 turns, $0.50 cap. Gaps go through the same retry path. | M | new `main/agents/agent-run-grader.ts`, new `main/agents/agent-run-grader-verdict.ts` (copy the pattern of `asana-triage-verdict.ts`) + tests, one step in `agent-run-loop.ts`, `--grade` flag in the task 3 files | Verdict validator rejects bad shapes. Loop test: grader says gaps then pass, so 2 builder runs and 2 grader runs, then it stops. Grader options contain no write tool and `resume: false`. |
| 6 | **Graph refresh (4.1).** After a successful run, if the folder has `graphify-out/` and HEAD moved, run `graphify update <path>` in the background. One at a time per repo, 5-minute timeout. | S | new `main/agents/agent-run-graph-refresh.ts` + test, one line in `agent-run-loop.ts` | With `spawn` mocked: no `graphify-out/` gives no spawn; same HEAD gives no spawn; two settles in a row give one spawn; a spawn error is logged only |

Task 6 is blocked on plan 2.1 (a graph must exist) and on the "Graphify vs no third indexer" decision (audit, line 244). It can wait without holding up 1-5.
Task 4's lesson appears in the next run with no extra work: `buildSystemPrompt` already includes memory (`main/agents/agent-run-prompt.ts:27`).

## (d) Risks

### Main-process code

- **Shared choke point.** Every agent run in the app passes through `agent-runner.ts`. Mitigation: a 12-line diff made once, and a pass-through path for runs with no check, proven by the unchanged existing tests.
- **Held callbacks could hang a caller.** If a loop step threw, a channel or voice caller would wait forever. Mitigation: the whole pipeline sits in one `try / finally` that always flushes; every check has a timeout (600 s maximum).
- **The check runs outside the agent's sandbox.** `precheck-runner.ts:130-135` spawns with `shell: true` and the app's full environment. An agent can edit `package.json`, so "run the tests" then runs code the agent wrote, unsandboxed. This is the same exposure as Carson running the tests by hand after an agent, but here it is automatic. v1 mitigation: checks are opt-in and typed by Carson. See question 7.
- **Two things in one folder.** While the check runs, another caller could start a run in the same folder and change files under it. Looped callers are held, others are not. Accepted for v1; the journal shows both runs.
- **App quits mid-loop.** The retry chain lives in memory. After a restart the last run shows a failed check and no `outcome`. Nothing is retried on boot, on purpose (same reasoning as `run-lifecycle.ts:101-104`).
- **"Success" notification before the check.** The run is marked `success` and a notification is written at `:207-219`, before the check runs. A failed check adds a second "Blocked" notification. Fixing the order would mean editing the stream loop, which this design avoids. Revisit after v1.
- **Run history is short.** Only 50 settled runs are kept (`agent-runs-store.ts:12`). Loops add rows, so history rolls over faster. The journal keeps everything.

### Cost of retries

- **Hard caps.** Default 1 retry. Absolute ceiling 3 runs per loop, enforced in the pure rule and again by a counter inside `attachRunLoop`. The cap is a constant in code. It is not something a prompt or an agent can raise.
- **One budget for the loop.** Today each run may spend up to $2 (`:70`). The loop's ceiling is 1.5 times the first run's cap. A retry gets "ceiling minus spent so far". Worst case for a default run: $3.00, not $4.00. Below $0.25 left, no retry.
- **Grader.** $0.50 and 15 turns per grading, at most 2 gradings. With grading on, the worst case for a default run is about $4.00.
- **Lessons cost nothing.** The lesson is the `LESSON:` line the retry already writes. No extra model call. A failed run with no retry gets a template line built from the check's first error line.
- **Graph refresh costs no tokens** (`graphify update`: "no LLM needed", read from `graphify --help` on this Mac).
- **No retry storms.** A retry is never started from a failed start (`:503-514` throws; the loop records Blocked). A grader run and a retry never carry a `postcheck` that could start a loop of their own beyond the shared counter.

### Never retry an outward action

A retry is refused, and the run is marked `needs-review`, if the attempt used any tool outside this local list:

- `Read`, `Write`, `Edit`, `Grep`, `Glob`, `TodoWrite`, `NotebookEdit`, `Task`;
- `mcp__dobius__read_knowledge`, `list_crew`, `crew_status`;
- `Bash`, unless the command matches an outward pattern: `git push`, `gh pr|release|issue`, `npm|pnpm publish`, `vercel`, `netlify`, `firebase deploy`, `curl`/`wget` with a write method, `dobius terminal send`, `osascript`, `ssh`, `scp`, `stripe`.

It is an allow list (a list of what is safe) on purpose. An unknown tool, such as Gmail, Asana, Telegram, Playwright or any new connector, counts as outward. The rule fails closed.
Also refused: every `channel`, `heartbeat`, `asana`, iMessage and voice run, and every Codex run.
The retry prompt repeats the rule in words, and the existing hard rails (`agent-hard-rails.ts:112-118`, no force push) still apply.
Limit to be honest about: the Bash pattern list cannot catch everything (a script that deploys, for example). That is why checks are opt-in and the default is a single retry.

## (e) The audit's doubt: what does `agent-runner.ts:433` load?

The line: `settingSources: isChannelRun ? ['project'] : ['user', 'project']`.

What I checked:

1. The SDK's own description (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1857-1866`, SDK 0.3.201): `'user'` = `~/.claude/settings.json`, `'project'` = `.claude/settings.json`, `'local'` = `.claude/settings.local.json`, and "Must include 'project' to load CLAUDE.md files".
2. The Claude program the runs actually use (`agent-runner.ts:438`; on this Mac `~/.local/bin/claude`, version 2.1.325). Its code loads `CLAUDE.md` and `.claude/CLAUDE.md` only when `projectSettings` is on, and loads `CLAUDE.local.md` only when `localSettings` is on. Read directly from the program's embedded source.
3. The app's own comment agrees: `main/agents/session-workspace-brief.ts:256-258` says SDK runs do not load `CLAUDE.local.md`, and the refresh at `agent-runner.ts:383` is deliberately not awaited.

Answer:

| What | Normal runs | Channel runs | Confidence |
|---|---|---|---|
| Project `CLAUDE.md` and project settings | loaded | loaded | verified |
| User settings and user `CLAUDE.md` | loaded | NOT loaded (`:428-433`, saves about 9,900 tokens) | verified |
| `CLAUDE.local.md` (the workspace brief) | NOT loaded | NOT loaded | verified |
| User hooks really firing inside an SDK run | expected | no | inferred from the SDK description; not run |
| Which folder "user" means when an agent has its own account | not traced | n/a | not verified (`buildRunEnv` applies an account environment patch, `agent-runner-environment.ts:19-23`) |

So the audit was half right. The line does load user and project settings. It does not load `CLAUDE.local.md`. The plan's 3.2 claim is true.

### What that changes for 3.2 (the briefing)

- Putting the briefing into the system prompt (`agent-run-prompt.ts`) is needed, and it is not a second copy. SDK runs never see the file version.
- Do not "fix" it by adding `'local'` to line 433. That would also load `.claude/settings.local.json` (each checkout's private allow rules) into unwatched agents. And because the refresh at `:383` is not awaited, a first run would often read an old or missing file.
- `buildSystemPrompt(agent)` (`:385`) takes only the agent today. 3.2 must pass it the folder or the rendered brief. That is one more edit to `agent-runner.ts`, so 3.2 joins the "one at a time" queue with these four items.
- Normal runs already get the project `CLAUDE.md` and the user `CLAUDE.md`. The briefing should add what those lack (branch, changes, graph, other tabs, spend) and not repeat them.
- Channel runs skip user settings to save tokens. A long briefing would undo that saving. Give channel runs a short briefing or none.

### What that changes for 4.2 (lesson write-back)

- The stated reason for 4.2 ("SDK runs skip user hooks") is wrong for normal runs and right for channel runs.
- So 4.2 is not the only learning path. Its job is narrower and still worth doing: a per-agent lesson based on a check or grader result, which a Bash-failure hook cannot know.
- New risk, not verified: Carson's global failure-learning hooks live in user settings. If they do fire inside unwatched SDK runs, the Stop hook that blocks stopping after two Bash failures and forces the `learn` skill would spend that run's turns and budget, and could write the same lesson twice. A 10-minute live check should be done before task 4: start one normal SDK run that fails two Bash commands, and see whether `/tmp/claude-learn-<session>.log` appears.
- 4.2 no longer needs the plan's anchors `agent-runner.ts:293,568`. The lesson is written at settle from the new file.

## (f) Open questions for Carson

Each has a recommended default. Work can start on the defaults.

1. **How many retries?** The plan row says up to 3 rounds; the brief for this pass says once. *Default: one retry, hard ceiling 3 runs.*
2. **Retry budget.** Fresh $2 for each attempt, or one shared ceiling? *Default: shared ceiling of 1.5 times the run's cap (worst case $3 on a default run).*
3. **Who can ask for a check in v1?** Only an explicit `--check` on a run, or also a default check saved on each agent or project? *Default: explicit only. Add a per-agent default after it has proven itself.*
4. **Automations and the terminal coordinator.** The plan row also names `run-lifecycle.ts:70` and `coordinator.ts`. Those launch terminal agents, which is a different retry mechanism. *Default: not in this pass. Reuse the pure rules from task 1 in a later item.*
5. **Where the lesson comes from.** The agent's own `LESSON:` line (free), or a separate small-model call as the plan row says? *Default: the free line. Add the model call only if the lessons turn out poor.*
6. **Who is the grader?** The same agent with a fresh session and read-only tools, or a dedicated built-in "Grader" agent with its own instructions? *Default: same agent, fresh session, read-only, on the agent's own model (house rule: reviewers stay on the top model). It is the smallest build; a dedicated Grader is more independent and can follow.*
7. **The check runs outside the sandbox.** OK for v1, given checks are opt-in and typed by you? *Default: yes, and strip sign-in tokens from the check's environment in task 2.*
8. **Graph refresh trigger.** App step after a run, or a git hook in `dobius/.husky`? The audit says pick one. *Default: the app step, only when HEAD moved; no hook change. Still blocked on plan 2.1 and the Graphify decision.*
9. **The possible double-learning path in (e).** May a worker run the 10-minute live check of user hooks inside SDK runs? *Default: yes, in the isolated test copy, before task 4.*

## Confidence

- **Verified** (read in this worktree, with line numbers): the run flow in `agent-runner.ts` and `run-lifecycle.ts`; the callback guard; the listener API and tool-use events; the precheck runner and its environment; the `agent.run` RPC shape; the absence of any postcheck; line 433 and what the Claude program 2.1.325 gates on each setting source; the `graphify update` command.
- **Inferred, not run:** that a wrapped `onSettled` is early enough for every caller (the comment at `:131-133` says so; no caller was traced end to end); that user hooks fire inside SDK runs; the dollar worst cases (arithmetic from the caps, not measured).
- **Not verified:** which folder "user" settings resolve to for an agent with its own account; behaviour of the 11 callers under held callbacks (none of them will use a check in v1).
- No tests or typechecks were run. This pass changed no code.
