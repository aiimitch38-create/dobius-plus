# Current Dobius build supervision

The current-build monitor uses `/usr/local/bin/dobius` against the local installed
app. It reads the Orchestrator task queue, scoped pending gates and ROOT inbox,
current terminal identities/activity, available native agent hooks, and the four
worker reports. It checks every 30 seconds and reminds ROOT every five minutes
about unresolved events. Ten minutes of quiet output prompts inspection; it is
not a failure verdict.

Reports up to 2 MB retain their historical evidence. A temporarily unreadable
report is retried for 60 seconds before raising an alarm, so an in-progress
worker write does not create a false failure. Last valid evidence is retained.

The `BUILD MONITOR` tab tails the bounded event log, including a heartbeat every
minute. macOS LaunchAgent `com.verlosolutions.dobius.current-build-monitor` keeps
the observer running across login. There is one process lock, private state, and
rotating logs. It does not invoke a model for each check.

Private runtime files live in
`~/Library/Application Support/Dobius Build Monitor/`: `config.json`,
`health.json`, `state.json`, and `events.jsonl`. The current scopes, native task
and dispatch IDs, prompt delivery receipts, and queued reviews are recorded in
`assignments.json` beside this document. ROOT must update the monitor configuration
when advancing a role to its next task or adding dependent reviews.

## Completion and dispatch

1. Inspect the current report and actual worker through Dobius CLI. Worker
   sandbox IPC is unavailable, so a saved report is the supported fallback.
2. Verify the report's task/dispatch identity, source hashes, results and limits.
   Update that exact Orchestrator task with source-delivery/review acceptance;
   do not imply runtime acceptance.
3. Inspect completed dependencies and the proposed next worker's actual readiness.
   Promote the exact dependent task to ready, dispatch through the Orchestrator,
   and deliver its current preamble/spec using runtime-bound, guarded terminal
   writes: paste first, then Enter. Verify the task reached the intended worker.
4. Keep unavailable authorities and live-activation gates explicit. A bounded
   foundation's PASS does not satisfy its production composition requirements.

Some existing Codex panes lack a correctly bound native hook record. Their
`agent_state` is deliberately `unknown`; connected terminals and fresh output
are still observed, and report changes notify ROOT. ROOT uses bounded terminal
readback to resolve actual readiness before assigning work. Missing hooks are
never interpreted as idle or completion.

Set `delivery_verified: false` when assigning a new role, then mark it true only
after readback shows acknowledgement or tool activity for that exact task. The
monitor surfaces an unverified delivery after 60 seconds. Accepted PTY writes
alone do not prove the TUI submitted the prompt; if readback shows it still
drafted, ROOT may send a separate bound Enter without pasting the task again.

The observer never dispatches, retries, restarts workers, completes jobs, resolves
permission gates, or edits source. It surfaces ready/unassigned jobs, completed
dependencies, worker completion awaiting reconciliation, unreadable reports,
disconnects, gates and quiet jobs to ROOT. Alerts are bound to the exact runtime,
ROOT handle, tab and pane. A changed runtime or manager identity requires ROOT
rebinding. An ambiguous paste/Enter is recorded and requires explicit readback
reconciliation; it is not blindly replayed.

AWS remains deferred. The historical Storage monitor and queue remain paused.
The older report-only watcher is paused after replacement; its previous state
is retained. Adam and Friday are outside this monitor's worker assignment scope.

## Operations

Read `health.json` to confirm a recent `checked_at`, live PID and `watching` state.
Pause only this observer by creating `PAUSE` in its private state directory;
remove that file to resume. A code update requires restarting only this monitor's
LaunchAgent, not Dobius or its worker terminals. If ROOT rebinding is necessary,
obtain current identities from `dobius status --json` and `dobius terminal list
--json`, then update the private config atomically.

Run deterministic monitoring tests from the repository root:

```sh
python3 -B -m unittest discover -s plans/worker-monitor-20261014 -p 'test_*.py'
```

Live verification includes a delivered BUILD2 report-change notification, ROOT's
exact hash verification and Orchestrator reconciliation, and a dependent review
queued after FIXER's current assignment. This checks the actual notification to
work-advancement path, beyond process liveness alone.
