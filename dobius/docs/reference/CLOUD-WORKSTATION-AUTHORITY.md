# Cloud workstation authority

Dobius uses one configured headless host for its new execution queue. The existing
Vertex task store remains the task master; these jobs reference its task IDs.
Opening either app does not migrate tasks or enable dispatch. An ordinary desktop
does not open this queue database, and an unconfigured host reports unavailable.

## Authority registration

The headless host reads `<canonical-user-data>/cloud-workstation/authority.json`.
The directory must be owned by the service account with mode `0700`; the bounded
regular JSON file must be `0600`. Symlinks, unsupported schemas and malformed
registrations fail closed. A registration error disables queue startup without
taking unrelated phone and terminal services down.

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "deviceId": "vps",
  "projects": [],
  "workspaceAccess": []
}
```

Projects use the strict `CloudProject` contract: project ID, enrolled device ID,
canonical root, allowed recipe IDs and platform capability. Workspace access binds
an exact project/workspace pair to authenticated **registry device IDs**, not
bearer tokens. Use observed existing task/workspace identities; do not invent a
parallel task master. Current startup supports locally verified host roots.
Laptop root enrollment needs the fresh authenticated remote-root authority before
it can be registered; a VPS cannot verify a laptop path with its local filesystem.

The queue is `jobs.sqlite` in that private directory. Startup always pauses
dispatch. Registration is rechecked when the store opens and on paired access;
disabled or unreadable configuration immediately denies reads and writes. The
worker-ready and independent-verification callbacks must be connected and accepted
before execution or completion can be enabled. The current startup deliberately
provides no eligible live worker or acceptance callback.

## Client reads

The desktop pins an explicitly selected authority environment independently of
its selected terminal. The phone uses its explicit host connection. Neither may
fall back to a local queue or mock jobs when the authority is unavailable.

- `jobs.status`: configured, generation, dispatchEnabled, liveDispatchReady.
- `jobs.snapshot`: `{limit?: 1..200, cursor?: opaque string}` returns generation,
  eventCursor, authorized jobs and nextCursor (null at the end).
- `jobs.get`: exact authorized current job.
- `jobs.events`: bounded sequence page, generation, resetRequired and nextCursor.

The first snapshot page atomically captures its row watermark and event cursor.
New submissions are excluded from later pages and arrive through subsequent
events. Existing jobs may change while pages load; merge by job version and catch
up from the captured event cursor. Opaque AES-GCM cursors are principal-bound,
expire after five minutes and do not expose denied job IDs. An empty authorized
page with a non-null cursor still needs another page. No in-memory list grows on
the server with the number of clients or cursors.

Restart/reopen rotates the authority generation and cursor key. An event cursor
ahead of restored history requires a new snapshot. Clients must reset on a changed
generation, clear denied details, reject late responses from another target, and
revalidate cached access. The bounded legacy `jobs.list` is not exhaustive.

## Authentication and verification

Local administration requires either the validated private local transport token
or a trusted first-party top-frame IPC sender. Partial paired identities cannot
be promoted to local authority. Paired clients derive their creator from the
authenticated registry ID; submitted creator fields are refused. Mobile clients
currently have read methods only. Root registration, dispatch activation and
completion acceptance remain local administration; command grants require a
separately accepted recipe/worker policy.

Successful execution moves a job to `needs_review`. Only an independent verified
receipt and matching current version can complete it. A result note, model text
or zero exit code cannot mark it Done. Cancellation requests retain reservations
until an authenticated worker cleanup receipt proves its owned attempt stopped.

## Storage status and coordination

`system.monitor.status` reads the separate enrolled private monitor snapshot and
returns a path-redacted summary, with source sampling time and recalculated
freshness. It creates no scheduler, reservations or cleanup actions. The laptop
monitor runs independently under `com.verlosolutions.dobius.system-monitor`;
Linux/Windows rollout remains separately gated. Partial folder inventory is not
reclaimable space or permission to remove a file.

The local build report observer uses distinct `terminal.sendBound` RPCs with an
expected runtime incarnation at the actual PTY write boundary. It refuses old
CLI/host pairs, missing agents and permission prompts, and checks both text and
Enter writes. It coalesces report filenames and never assigns work itself. Source
tests are not proof that the observer or packaged transport has been deployed.

## Current delivery limits

AWS is deferred by the user. No original eviction, S3 coverage or disaster restore
is inferred. Native phone version remains 0.0.22/build 2. Source tests and reviews,
installed desktop tests, authenticated VPS deployment, real executor containment,
Hermes profile/provider budgets and physical phone acceptance are distinct gates.
The historical external-drive queue remains paused.

Focused tests: `cloud-job-authority.test.ts`, `cloud-job-service.test.ts`,
`runtime-rpc-cloud-jobs.test.ts`, `runtime-rpc-mobile-grants.test.ts`,
`ipc/runtime.test.ts`, storage adapter/service tests and
`scripts/test_worker_report_watch.py`. Use the repository's Node 24 toolchain.
