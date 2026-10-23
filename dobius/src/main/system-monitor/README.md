# Main-process system monitor adapter

`adapter.ts` is a read-only boundary for the local C04 `status.json` snapshot.
The caller supplies enrolled device/root identities and the trusted storage
policy; this module does not load or mutate enrollment, install a service, or
refresh a monitor sample.

Every read checks a regular file in the private state directory, rejects
symlinks and group/world permissions on POSIX, and reads at most 2 MiB. Zod
validates runtime JSON shape and collection bounds before data is exposed.
Missing, malformed, untrusted, and mismatched snapshots produce typed
`unavailable` results. Producer `sampledAt` is Unix seconds; the adapter
converts it to milliseconds and recomputes freshness against the local clock,
including a five-second future-clock tolerance.
Windows reads return typed unavailable until an equivalent private-file ACL
check is implemented; the current monitor package does not claim a verified
Windows privacy boundary.

Device and root identifiers follow the path-free `CloudId` grammar
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. Volume identifiers are canonical
decimal device identities and must be referenced by an available registered
root; unavailable roots have no volume reference. The service projects only
these validated identifiers and bounded capacity/inventory totals, never local
root or state-directory paths.

The admission helper is a pure calculation. Callers must pass reservation totals
from the existing atomic capacity owner; this module stores no capacity state,
creates no second reservation, starts no process, and exposes no cleanup API.
The helper carries forward the producer's critical hysteresis state rather than
reclassifying a temporarily recovered sample on its own.

Focused tests:

```sh
pnpm exec vitest run --config config/vitest.config.ts src/main/system-monitor/adapter.test.ts --maxWorkers=1
```

`SystemMonitorService.status()` reads the private version-1 registration and
latest snapshot, recomputes freshness for each call, and returns a typed,
path-redacted `SystemMonitorView`. `freshnessSeconds` is the TTL from the
validated local policy for an available sample and `null` when the service
cannot provide an available sample; clients should age the sample from its
timestamp using a local monotonic clock and this TTL rather than treating the
initial `ageMs` as permanently current. A sample within the adapter's tolerated
future-clock skew keeps its sampled timestamp but exposes `ageMs: 0`, so clients
receive a nonnegative age without gaining extra TTL. Invalid registrations do not echo the device
ID; malformed root/volume relationships, including orphaned or path-like IDs,
make the snapshot unavailable.

The current application composition injects this service into desktop IPC and
runtime RPC as `system.monitor.status`. Desktop and paired-phone cards consume
the same read-only, path-redacted view. Source wiring and fixture tests are
separate from installed-host or physical-phone acceptance.

Scheduler admission, VPS publication, the C02 claim path, and ADAM consumption
remain separate integration seams. This reader does not create reservations,
control cleanup, or authenticate workers; those operations require their own
identity, atomic reservation, lifecycle, and review gates.
