# Cloud job board

The desktop Board and the phone host Tasks screen expose a read-only Jobs view of the VPS queue. Vertex tasks remain task metadata in their existing source. Each job references its `taskId`; a manual Vertex result note or Done move cannot complete a job. No migration or second writable queue is introduced.

## Entry points and authority

- Desktop: Tasks → Board → Jobs. `TaskPage.tsx` retains the existing Vertex entry. `KanbanBoard.tsx` opens `KanbanJobLanes.tsx`; Jobs never calls task lifecycle writes or the legacy dispatcher. Missing task sources report unavailable rather than supplying mock tasks.
- Desktop queue reads use an explicit registered runtime environment selected in the Jobs header. `cloud-job-authority-selection.ts` persists only the chosen environment ID under `dobius:cloudJobAuthority:v1`. A removed or malformed registration requires a new choice. Active terminal, runtime and worktree selection do not determine queue authority. There is no automatic local fallback.
- Phone: `/h/[hostId]/tasks` → Board opens `MobileCloudJobBoard.tsx`. Its source and details are scoped to the explicit `hostId`. Switching hosts disposes the previous reader and ignores its late replies.
- The desktop `SystemMonitorCard` always calls `system.monitor.status` with `{kind:'local'}`. It is independent of the selected queue environment. The phone `MobileSystemMonitorCard` calls the explicit current host client and labels only that host. Device telemetry for other workers is not yet available.

## Read contract

Both clients use `src/shared/cloud-job-projection.ts` through thin platform adapters. Their only queue methods are `jobs.status`, `jobs.snapshot`, `jobs.events` and `jobs.get`. Responses are validated with the canonical `CloudJob` schema and bounded response schemas before publication.

1. Read `jobs.status`. A configured authority must provide a generation.
2. Read every `jobs.snapshot` page with `limit:200`. Cursors are opaque strings of up to 1024 characters, principal-bound and valid for five minutes. An empty permission-filtered page with a non-null cursor still has more pages. Every page must preserve the first page's generation and captured event cursor; the stable row watermark excludes later submissions.
3. After completing the snapshot, drain `jobs.events` from its captured event cursor. Denied-only batches still advance the cursor. New versions are resolved through `jobs.get`; identity and version are checked and older versions cannot replace newer data.
4. A changed generation or `resetRequired` clears the old projection and bootstraps again. Two attempts bound restart races. Repeated cursors, regressing events, malformed responses and paging over 100 pages/batches fail visibly rather than showing a successful empty board.

Refresh runs every five seconds and is single flight. Each refresh reauthorizes the complete snapshot: a permission revocation need not emit a job event. Denied access clears cached jobs and details. Host/environment changes and unmount dispose readers, stop timers and reject late publication. Transport requests have a 15-second timeout. Network failure after a successful snapshot is labeled stale; initial failure is offline. Unsupported or invalid hosts are unavailable, unconfigured service is distinct, and dispatch paused/prerequisites missing are shown independently of an empty queue.

## Execution state and evidence

| Service state      | Visible lane |
| ------------------ | ------------ |
| queued             | Queued       |
| waiting_for_worker | Waiting      |
| running            | Running      |
| needs_review       | Needs review |
| completed          | Done         |
| failed             | Failed       |
| cancelled          | Cancelled    |
| interrupted        | Interrupted  |

Cards are not draggable and there is no manual job Done control. Details display actual job/task IDs, target, recipe, source revision, attempts, version, outcome and evidence references. Needs review requires independent acceptance; cancellation does not prove process cleanup; interrupted requires worker reconciliation. Evidence references are text, not a claim that artifacts have been fetched or verified. Queue/Cancel/Retry controls await ROOT's scoped verified mutation and recipe context.

## Monitor interpretation

Both widgets use the typed `src/shared/monitor-view-schema.ts` validator. Monitor timestamps and age are finite nonnegative numbers, including fractional milliseconds produced by Python Unix seconds; storage bytes remain integers. The monitor validates path-redacted capacity/root IDs, freshness and `cleanupEnabled:false`. It reports physical free space separately from logical and allocated inventory sizes. Partial/scanning inventory remains explicitly labeled; unknown sizes remain unknown. Stale, unavailable and unconfigured observations are distinct. There are no reclaimable estimates, delete controls, cleanup commands or model/API cost requests.

The desktop monitor keeps status primary, with compact `gap-1` spacing and grouped `text-xs` metadata. Available storage hides opaque volume IDs; known inventory registrations get friendly labels, and unknown registrations use tracked-folder ordinals without guessing paths. Details explicitly wrap source revisions, identifiers, titles and outcome text within the panel using existing typography and color tokens.

Server polling remains every 60 seconds. Between polls, the display updates each second using server-reported `ageMs` plus the larger of local monotonic elapsed time, local wall-clock elapsed time and zero since **request start**. Delayed delivery therefore consumes TTL rather than renewing it. Absolute host and client clocks are never compared. The local wall-clock delta covers platforms whose monotonic clock pauses during OS sleep; a forward local clock jump may conservatively mark a reading stale. Each reading retains its elapsed high-water mark, so a later backwards clock correction cannot renew the TTL. Desktop visibility and phone AppState resume immediately revalidate the local display without issuing extra server polls or changing focus. Server stale/skew/unavailable readings cannot become fresh; legacy absent or null `freshnessSeconds` fails closed. Late replies from old phone hosts are ignored.

## Verification and acceptance

Focused tests cover the real SQLite service/RPC envelope shared by authenticated desktop and paired phone readers, all eight states and matched identities, opaque cursor length, empty filtered pages, denied batch advancement, permission revocation, generation reset, out-of-order versions, host-switch races, malformed data, explicit authority persistence, typing focus, Jobs/task separation and monitor scope/freshness. Renderer and phone type checks and scoped lint are recorded with exact source hashes in BUILD1's C06 freeze report.

Installed desktop/native phone acceptance is still ROOT-owned. No deployment or native version change is part of this package; phone remains 0.0.22/build2. After independent review, verify the same job IDs on both clients against the configured VPS, switch desktop terminals/worktrees while keeping the queue pin, change phone hosts during delayed reads, revoke workspace access, restart the service, and confirm typing/tab selection remain unchanged. Worker crash, real dispatch, artifact access, device telemetry and mutation acceptance require their separately approved prerequisites.
