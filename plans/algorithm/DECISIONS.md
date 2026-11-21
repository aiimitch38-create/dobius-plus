# Algorithm Decision Log — Manager tab "operating layer" (2026-07-12)

Append-only. Each KILL records the future evidence that would justify re-adding it,
so the ~10% add-back rate is measurable. Grounding: two scout reports (committed
state at `dobius/src/main/manager/`, `dobius/src/main/ipc/manager.ts`,
`dobius/src/renderer/src/components/manager/`), branch `feat/manager-operating-layer`.

## Kills

| Date | Item | Why it died | Re-add trigger |
|---|---|---|---|
| 2026-07-12 | **Send email from the Manager tab** | Outward action on a real account; unverifiable automation surface; reading/searching mail plus opening Gmail in-app covers the workflow without the risk. | Read/search email ships, gets daily use, and replying in the embedded Gmail webview proves genuinely painful. |
| 2026-07-12 | **Provider write ops (move/rename/delete/share) in v1** | Destructive surface against live Drive; open-in-app webview gives the real Drive UI for writes at zero build cost. | A specific write action is performed via the webview 3+ times a week (count it) and round-tripping hurts. |
| 2026-07-12 | **Multiple accounts in v1** | Solo user has exactly one wired account (`manager.ts:16`); bridge Map already supports many, so this is UI+config work with zero users. Webview session partitions already solve multi-login for embedded pages. | A second real Google account needs indexing — then mirror `AccountsPane.tsx` and expose `unregisterSource` over IPC in the same task. |
| 2026-07-12 | **Microsoft 365 / other providers in v1** | Solo user is Google-only; `document-source.ts` seam makes later providers cheap by design. | A real M365 account with real documents enters the workflow. |
| 2026-07-12 | **Per-account refresh button in the UI** | With one account, `refreshAll` IS per-account refresh. The IPC (`manager:refreshAccount`) stays — it's built and harmless. | Ships with multi-account. |

## Add-backs / reversals (the ~10%, measured)

| Date | Original verdict | What live use proved | New state |
|---|---|---|---|
| 2026-07-12 | TASK-1: open docs in the in-app webview (KEEP, "highest reuse lever") | The embedded browser has its own cookie jar — every Google doc opened to a Sign-in wall (user screenshot). Session partitions solve multi-login only if the user logs in there, which is friction with zero payoff over the default browser. | REVERSED: rows open in the system default browser. In-app open returns only if a use case needs docs beside terminals badly enough to justify a one-time webview Google login. |
| 2026-07-12 | Drive source: flat, no folder resolution (ponytail deferral) | User needs folder structure to navigate ("folder 'Elderly people' → drop down → see the photos"). | ADDED BACK: parents field + folder names resolve in the same API call; Folders section in the rail; folders excluded as docs. This was the predicted ~10%. |

## Kills — round 2 (bundles feature, 2026-07-12)

| Date | Item | Why it died | Re-add trigger |
|---|---|---|---|
| 2026-07-12 | **Full-content extraction from Drive for clustering** | 598 per-file downloads/exports per refresh to improve grouping that name+path+snippet term math can prove first. | Bundles built from names/snippets feel shallow after 2 weeks of real use — then extract content for the top-N most-accessed docs only. |
| 2026-07-12 | **LLM / embedding-based clustering in v1** | API cost + latency + nondeterminism before the cheap deterministic version has ever been seen; the suggester's output is a UI suggestion, not a judgment call needing intelligence yet. | Term-math bundles are demonstrably wrong/noisy on real data AND the user wants semantic grouping (then: small local embedding or one Haiku classify pass, still suggestion-only). |

## Kills — round 3 (agent-memory arc, 2026-07-13)

| Date | Item | Why it died | Re-add trigger |
|---|---|---|---|
| 2026-07-13 | **Embeddings / RAG server for agent context** | The brief (TASK-7) is an assembly of indexed facts over a ~1k-doc corpus; SQL filter + truncation covers it. A vector store is infrastructure for a retrieval problem we don't have yet. | Corpus grows past what a filtered brief can hold AND agents demonstrably miss relevant filed items that semantic search would find. |
| 2026-07-13 | **Agents writing outputs back into the index (two-way memory)** | One-way (read) must prove valuable first; write-back adds provenance/trust questions (what did an agent file, was it right) before the read path has a single real use. | TASK-6/7 briefs are used by real sessions for 2+ weeks AND the user asks "why isn't the report the agent made in the Manager?" |
| 2026-07-13 | **Auto-injecting briefs into every project terminal at open** | Injection before demand: costs tokens in every session for projects whose briefs may be empty. The CLI/copy path (TASK-6/7/8) proves demand first. | Briefs get pulled manually 3+ times for the same project (rep counter can see the CLI calls). |

## Questioned / deferred (not killed)

| Date | Item | Status | Note |
|---|---|---|---|
| 2026-07-12 | **Manager vs Knowledge indexer convergence** | DEFERRED — decide before either grows another source | Two indexers now exist (Manager = cloud Drive via `manager/`, Knowledge = local files via `knowledge-indexer.ts`). Converging is an architecture task, not a v1 UI task. Do not add a third indexer anywhere before this is decided. |
| 2026-07-12 | **Disconnect-account UI (`unregisterSource` not exposed over IPC)** | DEFERRED | Real gap found by scout, but meaningless with one hardcoded account. Bundle with multi-account. |

## Not ready to automate (step-5 re-test candidates)

| Date | Candidate | Missing | Re-test when |
|---|---|---|---|
| 2026-07-12 | Scheduled background index refresh (auto-refresh every N min) | 0 evidence the manual Refresh button cadence is a pain; rep log too young to show anything (counter run 2026-07-12: no command ≥3 reps) | After 2 weeks of real Manager use, check the rep log / usage for refresh frequency. |
| 2026-07-12 | Any build-loop automation for this feature | Rep log 1 day old; nothing has 3 reps | Re-run `reps.py` at feature end (build-mode step 5). |

## Round 4: workstation build plan review (2026-11-21)

| Date | Item | Verdict | Why | Re-add when |
|---|---|---|---|---|
| 2026-11-21 | 1.8 Port the preflight primer from the JS app | KILL (merged into TASK-07) | TS app already generates a workspace brief; extending it is smaller than porting | never as a port |
| 2026-11-21 | 1.1 Port "Report a problem" | KILL (merged into TASK-09) | TS app has SidebarFeedbackDialog; the bug button supersedes it | Carson wants report-via-teammate specifically |
| 2026-11-21 | 1.2-1.7 Port Sam's features | QUESTION (blocked on D1) | Porting into an app Sam does not work in is a treadmill: every future Sam commit needs porting too | Carson + Sam pick one base app |
| 2026-11-21 | 2.2 Unified event bus / ledger | KILL for now | Nothing observable breaks today; TASK-06 stores results on the run record | a second consumer needs cross-run history |
| 2026-11-21 | 2.1 Graphify on every project at once | SIMPLIFY to one repo | other repos get one on first use | - |
| 2026-11-21 | 3.1 Animated loading screen | QUESTION | briefing measured ~57 ms in the JS primer; a screen would flash. Status line instead | briefing takes >1 s |
| 2026-11-21 | 3.4 Separate stale-graph rule | KILL (folded into TASK-07/08) | post-commit refresh keeps it fresh; a freshness stamp covers the rest | stale graphs seen in practice |
| 2026-11-21 | 4.3 Separate grader agent | KILL for now | expensive; postcheck covers mechanical failures | 3+ cards pass postcheck but Carson rejects them |
| 2026-11-21 | 4.4 Vault note per finished card | KILL for now | vault-capture.sh already writes daily session notes and nothing reads them yet | TASK-07 reads vault notes and wants card-level ones |
| 2026-11-21 | 4.5 Fix "Dobius Agent Activity" notes | KILL | stopped 2026-10-23, writer not found, no reader | someone needs the activity feed |
| 2026-11-21 | 4.6 Count non-Bash failures in learn hook | QUESTION | small, but no evidence of missed lessons | a repeated Edit/Write failure goes unlearned |
| 2026-11-21 | 5.6 Automatic after-fix screenshot | KILL for now | L size; human review covers it | bug button used 5+ times |
| 2026-11-21 | 6.6 Telegram approve-from-phone, /tabs | KILL for now | basic bridge first | Carson uses the bridge daily |
| 2026-11-21 | 7.2 Turn on Laya | KILL for now | needs the model service running; build plan says no new intelligence before the foundation | TASK-06 shipped and a Laya host is up |
| 2026-11-21 | 7.3 Per-tab live checklist | KILL for now | Claude Code already shows its to-do list in the terminal | cards dispatched from Kanban need it |
| 2026-11-21 | 7.4 Run adoption gate | KILL for now | serves ADAM two-brain safety, no current incident | an unmanaged run causes a problem |
| 2026-11-21 | 7.5 Cloud job buttons | KILL for now | no known user of cloud jobs | Carson submits cloud jobs by hand 3x |
| 2026-11-21 | 7.6 Hook status in Settings | KILL | nothing broken | hooks silently missing causes a bug |
| 2026-11-21 | 7.7 Usage detail table | KILL -> delete the orphan (needs OK) | unused file | Carson asks for per-session usage |
| 2026-11-21 | 7.8 Voice client for voice.intent/reply | QUESTION | depends on TASK-04 | TASK-04 finds a client to reuse |
| 2026-11-21 | 8.1 Replay evals | KILL for now | no frozen task set yet | agent instruction changes cause a regression |
| 2026-11-21 | 8.2 Weekly skill cleanup automation | KILL | one-time job, not weekly; the "10 duplicate skills" were not found in ~/.claude/skills (0 matches), location unverified | duplicates confirmed and keep reappearing |
| 2026-11-21 | 8.3 Gmail intake, 8.4 Command Center backing | KILL for now | L, unrelated to the one-sentence-to-action goal | Carson asks |
| 2026-11-21 | Step 5: automate any command | NOT READY | top reps are 3-4 in 14 days, all one-off cd/inspect commands in old worktrees, nothing stable | the build-in-test-copy loop is run 3x the same way |

## Add-backs / reversals, round 4

| Date | Original verdict | Evidence | New state |
|---|---|---|---|
| 2026-11-21 | 2026-07-13 KILL: auto-inject briefs into every terminal at open | Carson built the preflight primer himself (2026-11-14, branch agent-preflight-primer) and asked for it again 2026-11-21. That is the demand signal; the original trigger (3+ manual pulls) was not measured. | RE-ADDED as TASK-07, capped at 16 KB with per-section freshness stamps |

## Open conflict, round 4

- 2026-07-12 rule: "Do not add a third indexer anywhere before Manager vs Knowledge convergence is decided." Graphify (TASK-05/07/08/11) is a code-graph indexer. Carson decides: treat Graphify as the Knowledge source for code (converge), or override the rule.
| 2026-11-21 | 1.2-1.7 Port Sam's features | UNBLOCKED | Carson: "your TypeScript app is the main app". Each port still needs a check that this app lacks the feature first | - |
