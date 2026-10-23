# Workstation worker supervision contract

These are staging contracts only. Nothing here installs a service or claims the
laptop or VPS is enrolled. The worker refuses Windows because descendant
containment is not implemented there. POSIX execution uses one detached process
group, a private `0700` state directory and atomic `0600` attempt journals. The
service account, executable digest, canonical state path, restart backoff and
log rotation must be filled from reviewed device enrollment before activation.

## Service contract

- One supervisor instance per stable enrolled worker/profile ID, protected by an OS
  single-instance lock. Each profile worker has its own identity while multiple
  workers may target the same enrolled hardware device. State lives under that service UID's private state
  directory; the VPS queue database is never mounted into a laptop worker.
- All profile workers on one device share a canonical private `coordinationPath`.
  The worker takes identity-keyed worktree and Hermes-home reservations there,
  independent of per-worker journal paths, before awaiting server authorization.
  Reservations remain held through ambiguity and release only after cleanup and
  queue settlement are proven. Stale locks are never unlinked by inspection
  alone: reconciliation verifies the recorded job PID/start/PGID and queue
  ownership, then claims each unchanged owner record under a recovery guard.
  Changed, unreadable or unverifiable ownership remains fenced for review.
- Start only a pinned worker executable after verifying its source/build digest.
  The service has no shell command channel, UI dependency, implicit home-root
  fallback, or Hermes cron import. Restart backoff is 5, 15, 30, then 60 seconds
  capped; repeated journal/identity failures remain fenced for operator review.
- Journals keep attempt/job/device/incarnation/boot IDs, the encrypted lease receipt,
  exact revision and root/worktree/profile IDs, PID/start/PGID, byte/log cursor,
  bounded output tail, and terminal observation. Lease tokens never enter logs.
  The runtime requires an injected authenticated sealer; ROOT must bind it to the
  host OS secret store before enrollment.
- Configure OS memory/CPU/task limits and bounded service logs at enrollment. The
  portable executor enforces wall time, output bytes and evidence tail while its
  supervisor observes the process; it does not install Linux cgroups or macOS
  resource controls. Reattached processes retain their original wall deadline and
  persisted output count, but the supervisor cannot reattach the former
  stdout/stderr pipes to measure additional bytes. Memory/CPU caps are admission
  ceilings until host controls are verified. Keep recipes requiring hard
  output, memory or CPU ceilings disabled until host enforcement and restart
  behavior are verified.
- Process enumeration (`ps`) is a startup prerequisite. The worker probes its own
  start time and process group before constructing journals or accepting claims;
  an environment that denies inspection fails before any recipe child can spawn.
  Recovery takes the worker journal lock before queue reconciliation and keeps it
  through the recovered watcher, preventing duplicate heartbeat or settlement
  loops from independent supervisors.
- Shutdown requests cancel through the owning worker. Never use broad `pkill`
  by executable name. Reservations remain held until the queue accepts a stop
  receipt after the process group is observed empty.

## Hermes profile registry contract

Register exactly these slot IDs in the authenticated enrollment record:

| Profile ID | Private runtime home    | Exclusive worktree  | Allowed roots/recipes | Credential reference       |
| ---------- | ----------------------- | ------------------- | --------------------- | -------------------------- |
| `hermes-1` | distinct private path A | distinct worktree A | explicit allowlist A  | secret-manager reference A |
| `hermes-2` | distinct private path B | distinct worktree B | explicit allowlist B  | secret-manager reference B |

Homes, worktrees and live profile leases must be pairwise exclusive. Registration
does not assert these paths, credentials, Hermes binaries, model access, tools,
or Hermes headless/resume flags are configured. Each slot stays disabled until an
operator pins the executable/version and independently verifies auth, supported
arguments, transcript/hook isolation, persistence and provider budget. A job can
name only a registered profile ID; it cannot supply a home, environment variable,
credential, command, or Hermes arguments. Missing or unverified auth refuses the
launch. Shared `~/.hermes`, TUI-idle completion, and implicit cron execution are
not worker contracts.

## Root and revision enrollment

The authenticated server record binds device ID, root ID, canonical absolute
path, platform identity/inode or equivalent, permitted recipes, and policy
version. Each worktree ID maps to a distinct canonical Git linked worktree under
that root; the worker verifies the link and exact `HEAD` before launch. The caller
cannot supply an executable or argv; those come from the local recipe registry.
The initial source worktree must have the exact requested `HEAD` and a clean Git
status with no tracked changes or untracked files. No dirty-snapshot bypass is
implemented. The worker does not reset or clean the worktree: source changes made
by a job are preserved and returned as bounded status/diff hash evidence tied to
the attempt. Hermes homes must be canonical, non-symlink directories, owned by
the service account, private from group/world access, and unique by filesystem
identity; root, worktree and profile-home device/inode identities are pinned
across the authorization wait and checked again before spawn.
The worker verifies the enrolled root and worktree identities, exact clean
revision, and active worktree reservation locally. Server enrollment remains
responsible for mount attestation and provisioning; a missing or replaced root
waits for explicit reconciliation, and the worker never recreates a mount.

`QueuePort` is the only queue boundary here. Claims, leases and stop receipts use
the stable worker/profile ID; `WorkerJob.deviceId` targets the enrolled hardware.
ROOT supplies authenticated claim, start-authorization, start-ack, heartbeat,
cancellation and settlement transport and binds every operation to the durable
C02 lease/version. Before writing launch intent or spawning, the worker requires
a fresh server-authorized start permit matching attempt, worker, device, profile,
root, worktree, recipe, source revision and all resource caps. It rechecks permit
expiry and local root/worktree/revision/recipe identity immediately before spawn.
Schema-valid leases alone never authorize a child. Heartbeat is scheduled at 15 seconds
against the proposed 60-second lease; network loss terminates the owned group and
keeps the attempt ambiguous until server reconciliation. Queue results are
observations and evidence, never an automatic `completed` transition.

BUILD2's C02 contract makes `CloudRootAuthority.getFreshRoot({projectId,
deviceId})` server-owned and valid only from authenticated enrollment. The ROOT
adapter must bind that response to the claimed project/device and pass the
authoritative root identity into local enrollment checks; a job-supplied path is
never root authority. C05's local canonical-path and exact-revision checks are a
second execution gate, not a replacement for server authority. `reservedBytes`
means the worker's total heartbeat reservation including queue-owned estimates:
the adapter must report that total once and must not add the queue estimate a
second time. Neither authority nor reservation transport is implemented here.

## Durable lease sealing

`openDurableLeaseSealer({ stateDirectory, journalPath })` is a local primitive;
the worker does not construct or activate it automatically. It accepts only an
existing canonical service-owned POSIX state directory with exact mode `0700`.
The key is atomically published as `lease-sealer.key` with exclusive creation,
mode `0600`, and exactly 32 random bytes. Opening uses no-follow and nonblocking
flags, then verifies owner, file type, mode, size, and stable device/inode/content
before every seal or unseal. Windows remains unsupported until ACL ownership
checks are implemented and verified.

Tokens use AES-256-GCM with a fixed versioned associated-data domain. Reopening
the same key decrypts existing receipts; tampering, key replacement, symlink,
FIFO, wrong permissions, or malformed key size fails closed. If the key is
missing while the attempt journal exists, initialization refuses to create a
replacement key, so the existing journal remains untouched. Do not rotate the
key to recover from this error: preserve state and require explicit operator
reconciliation. Key bytes never enter arguments or logs. Tests create keys only
inside temporary fixture directories; no service-state key has been created.

This primitive is not yet wired to the claim/source prelaunch decline protocol.
ROOT/C02 must supply that integration before any production worker invokes it.

macOS/Linux closed-app service templates, cgroup/job-object enforcement, remote
VPS enrollment, authenticated transport, C04 capacity freshness, physical volume
reservations and real Hermes configuration are rollout gates. No service is
installed by this directory.
