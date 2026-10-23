# Data catalog browse registration

The registration store records explicit browse permission. It is configuration,
not another editable copy of files, notes, jobs, tasks, or artifact manifests.
The main process supplies a directory chosen through a native folder picker;
no catalog browse RPC accepts a filesystem root path from a client.

Each root has an opaque ID, canonical directory path, full-width device/inode
identity, a versioned native incarnation token, kind, label, and registration
generation. Catalog responses expose
the ID and display metadata, never the canonical absolute path. The scanner
must independently validate root identity and permission on every page; a
registered path is not proof the directory still exists or remains unchanged.

Desktop enrollment starts with no phone access. Phone access requires an
explicit grant to a currently paired device ID. Every authorization checks
the current pairing registry again, so unpairing immediately makes the grant
ineffective. Changing grants rotates the root generation and invalidates old
catalog cursors. Replacing a chosen folder does not inherit its phone grants, even when the
filesystem reuses both the inode and creation timestamp. Grant inheritance requires
the same native provider, filesystem scope, token, device and inode.

Removing a registration removes permission only. It never deletes, moves,
uploads, archives, rewrites, or reads the contents of original files. Repeating
enrollment of the same canonical root reuses its opaque ID. Concurrent picks
read the latest registry after filesystem checks and preserve each other.

Writers take an exclusive private registry lock before reading the current
state and committing a change. Reads refresh disk state for every authorization.
This prevents separate desktop/server instances from overwriting each other's
grants or revocations. A contended lock reports a retryable busy error. A crash
may leave a lock that requires owner reconciliation; it is never automatically
removed by guessing its age. Only the writer's own inode is removed on exit.

The private registration JSON is written atomically with mode 0600. Corruption,
unknown fields, duplicate root identities, and duplicate canonical locations
fail closed. The existing SafeJsonFile recovery mechanism preserves an unreadable
copy and refuses overwriting the damaged registration. Registrations are bounded
to 100 roots and 64 paired devices per root.

Job execution enrollment, monitor inventory, default workspace directories,
and artifact links do not confer catalog browse permission. Personal folders
and Obsidian vaults are never enrolled by discovering paths from these sources.
Native picker/RPC/Settings integration is source-wired; installed desktop and
physical phone acceptance remain separate gates. No root is discovered or scanned
automatically, and no original file preview, archive or hydration is enabled.

## Native identity and legacy recovery

Enrollment requires the injected metadata bridge to capture identity from the
same directory descriptor it opened without following symlinks. Two bounded
captures must match the selected canonical path and exact device/inode. The
provider token is checked again at authorization and descriptor opening before
metadata is returned. A timestamp alone is insufficient: a disposable Linux
stress test reused the inode and birth timestamp in 13 of 100 replacements.

The tested providers are Linux inode generation on a supported ext filesystem
with its filesystem scope, and native Mac APFS volume UUID plus full-width file
ID. Unknown filesystems, missing helpers and unavailable proof refuse enrollment
and scanning. Windows remains unsupported for native scanning. Creation time is
optional metadata, never authority. The descriptor runbook documents the exact
provider checks and practical trusted-filesystem limits, including privileged
filesystem modification, cloned images and rollback.

Legacy registrations remain visible for local recovery or removal. Their old
phone grants are hidden and cannot authorize scanning or sharing. Explicit native
re-enrollment obtains current proof, rotates the registration generation and
clears grants rather than silently upgrading old evidence.

Closing the application cancels pending enrollment. Each native capture has a
one-second deadline, and cancellation is checked again before the synchronous
registry write. A late native response cannot persist a cancelled selection.

Verification uses temporary fixtures only:

```sh
pnpm exec vitest run --config config/vitest.config.ts \
  src/main/storage/data-catalog/root-enrollment-store.test.ts \
  src/main/storage/data-catalog/root-enrollment-identity.test.ts --maxWorkers=1
```
