# Local storage monitor (C04 source slice)

This Python standard-library service samples registered volumes and inventories
registered folders without Electron. It writes a private local status file. It
never deletes monitored files, executes jobs, publishes to the network or invokes
a model. No scheduler has been installed by this package. C04 live integration
and acceptance remain open.

## Local contract

Device and root IDs use the path-free `CloudId` grammar
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`; they are metadata tokens, not paths.
Volume IDs are canonical decimal strings for the registered root device
identity (`str(st_dev)`). Each available root must reference that exact volume,
each unavailable root has `volumeId: null`, and every emitted volume must be
referenced by an available registered root. Invalid, orphaned, or spoofed
references fail closed.

`storage_monitor.py --base <private-state-directory> <command>` supports:

- `init --device-id <stable-device-id>` creates version 1 config with no roots.
- `register --id <root-id> --path <absolute-existing-directory>` records the
  directory device/inode identity. Overlaps and symlink components are rejected.
  Missing roots are never created; there is no home-directory fallback.
- `sample` performs one bounded inventory tick and writes `status.json`.
- `daemon` samples capacity every configured interval (default 60 seconds), runs
  one bounded inventory tick per second, and handles SIGINT/SIGTERM. An OS lock
  excludes other writers, including registration, while the daemon is running.
- `status` reads the last sample and adds computed freshness. Consumers must use
  freshness as well as health; saved healthy data is not proof of current health.
- `admit --root-id <id> [--estimate-bytes <bytes>] [--reserved-bytes <bytes>]`
  prints a decision, exiting 0 for admission or 2 for refusal. Invalid config or
  I/O errors exit 1. Admission is a calculation, not an atomic job reservation.

Default state lives under macOS Application Support or Linux XDG state. Config
and status are private, size-limited JSON, atomically replaced and fsynced. There
are at most 32 roots, 200 alerts and 60 history points per volume. No credentials
belong in these files. Stop the separately supervised monitor before changing
its config or staged code; validate before restarting. A process failure leaves
the last timestamp intact so readers eventually show stale, never a fresh sample.

Shared TypeScript interfaces live in `src/shared/system-monitor.ts`. Timestamps
are Unix seconds (inventory generation is a string); sizes are bytes. Status
contains root availability/identity, per-volume capacity, inventory progress,
trends, bounded alert history and top registered roots by observed logical size.
`cleanupEnabled` is false and `cleanupReceipts` is always empty. The publisher is
`private_local_file`; no remote telemetry or app UI is connected.

## Inventory and resource limits

On POSIX, every root/relative directory is opened with directory descriptors and
`O_NOFOLLOW`, and checked against its recorded device/inode. Open traversals are
revalidated between ticks. Symlinks and other-device mount entries are skipped;
permission failures and changed directories produce partial results. Names and
metadata are read; file contents are not. This is a live observation, not a
transactional filesystem snapshot or defense against every same-user race.

Only one unfinished traversal is retained, even when configured roots reorder.
Defaults limit each tick to 2,500 entries and 0.1 seconds; supported settings cap
these at 10,000 and 1 second. Each scan retains at most 50,000 file identities,
10,000 discovered directories and a depth of 64 by default (configurable to 128).
Queued relative paths additionally have a fixed 2 MiB encoded-byte budget.
Exhaustion clears the frontier/inode set and reports partial with `limitReached`.
Finished scans release descriptors and deduplication sets. Error details retain
at most 16 paths, each truncated at 512 characters with `pathTruncated`; the total
error count remains available. A scan refreshes after 900 seconds by default.
Traversal is sequential across roots; a very large root can delay later roots.

Time limits are cooperative between filesystem operations; a stalled filesystem
call cannot be preempted. No hard macOS RSS or I/O latency guarantee is claimed.
Live CPU/RSS and terminal responsiveness under load require deployment testing.
Read-only inventory does not evict pinned files or active worktrees; this package
provides no cleanup eligibility decisions.

Logical bytes are file lengths; allocated bytes use `st_blocks * 512` when
available. Hardlinks are counted once per root. Separate roots can still share
hardlinks or APFS extents. Shared-volume capacity is deduplicated by device ID,
using the minimum observed available space. APFS clones/compression/container
sharing mean folder totals are not reclaimable bytes: `reclaimableBytes` is null.
Do not sum separate APFS volume capacity into an assumed physical pool.

## Admission and freshness

Defaults warn below max(20 GiB, 15%) and become critical below max(10 GiB, 8%).
Recovery requires the corresponding threshold plus max(2 GiB, 2%). Alerts record
transitions, avoiding repeated warnings for unchanged state. Samples older than
180 seconds are stale; timestamps more than five seconds ahead indicate clock
skew. Root/config identity or device mismatches and unavailable volume readings
refuse admission. Invalid capacity or health values also refuse admission.
Malformed persisted root/volume containers, including non-object rows, return an
`unavailable` decision instead of an uncaught traversal error.

Admission subtracts the job estimate, all concurrent reservations for that volume,
and a 5 GiB safety margin, then requires the critical reserve to remain. An unknown
estimate defaults to 20 GiB. Critical hysteresis still blocks launch. The caller
must supply authoritative reservations and atomically reserve capacity with claim;
parallel callers receiving `allowed` cannot independently assume ownership.
Capacity must be rechecked at launch. This module does not inspect processes or
provide leases, reservation persistence, fencing or cancellation.

## Scheduling templates and platform coverage

`prepare_monitor.py --base <private-state-directory> --device-id <id>` copies the
four runtime modules into `code/` and renders a schedule into `schedule/`. It does
not register, load, enable or start any service. Use a persistent, executable
Python path. Config is preserved if already present. Stage only while stopped.

macOS output is a launchd plist using explicit argument arrays, KeepAlive,
ThrottleInterval, background process type, Nice 10 and low-priority I/O. It is
only parsed in tests; no launchd lifecycle or log rotation has been proven.
Linux output is a user systemd service with argument escaping, restart throttling,
UMask 0077, Nice 10, idle I/O, MemoryMax 192M and CPUQuota 15%. Those controls require
support in the target user service manager/cgroup configuration; rendering is not
proof of enforcement. Native Linux service acceptance is pending.

Windows automatic scheduling and descriptor-safe inventory are unsupported.
Preparation explicitly returns `schedulingSupported: false`; the basic manual
capacity fallback has not been verified on Windows and is not a supported rollout.

## Required main-process and VPS integration (outside this ownership)

1. `src/main/system-monitor/adapter.ts` provides a focused read-only adapter. It
   accepts enrolled device/root identities from its caller, reads only a bounded
   private `status.json`, validates its runtime schema, and recomputes freshness
   in milliseconds from the producer's Unix-second timestamp. It maps
   missing/malformed/untrusted snapshots to typed unavailable results. Its pure
   admission view requires reservation totals from the existing atomic owner;
   it never creates a reservation, refreshes producer timestamps, or performs
   cleanup. The enclosing app still must wire enrollment and approved settings.
2. Recompute freshness on every read and after sleep/reconnect; preserve source
   sampling timestamps. IPC/RPC must never refresh timestamps merely by forwarding.
   Treat partial inventory separately from volume health and never infer deletion
   eligibility from sizes or root availability.
3. Wire enrollment and approved root/policy settings to serialized config writes,
   with controlled service lifecycle and re-registration on changed root identity.
   No automatic activation, root discovery or filesystem fallback is authorized.
4. Publish bounded authenticated device-health events to the VPS; redact local
   paths for consumers without root access. Add SSH/remote device identity and
   freshness handling. There is no publisher implemented in this source slice.
5. Integrate C02/C05 atomic per-volume reservations, capability/lease checks and
   launch-time capacity refresh. Map refusals to explicit waiting reasons. Shared
   APFS physical-container reservations require an explicit verified pool mapping.
6. Add Jobs/System displays and notification deduplication using source identity
   and transitions. Retained alert arrays alone are not a durable delivery outbox.
7. Complete macOS/Linux service lifecycle, sleep/offline, resource-load and both-app
   verification under ROOT rollout ownership. Full app typechecks remain a ROOT
   integration gate. Windows must remain visibly unsupported until implemented.

## Focused verification

From the canonical repository root, using existing Python only:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover \
  -s dobius/config/scripts/system-monitor -p 'test_*.py' -v
```

Fixtures use temporary directories and mocked capacity, never fill the real disk.
Coverage includes sparse files, hardlinks, symlink/root replacement, permission
errors, mount skipping, scan budgets, config reordering, stale and skewed clocks,
hysteresis, concurrent reservations, private state, single-process locking,
schedule rendering, and a standalone temporary daemon with no Electron dependency.
Linux templates are tested as text on macOS; this is not Linux runtime evidence.
