# Data catalog descriptor bridge

The catalog scanner requires directory handles whose child operations are
relative to an already-open directory. Node's portable path-based filesystem
calls do not provide that boundary, so the POSIX adapter keeps directory file
descriptors in a private Python child and exposes the metadata operations
needed by `MetadataFileSystem` plus a separate, explicitly invoked bounded
preview capability.

## Boundary and protocol

`src/main/storage/data-catalog/descriptor-directory-bridge.ts` exports
`createDescriptorDirectoryBridge({ pythonExecutable, scriptPath,
operationTimeoutMs })`. `descriptor-directory-transport.ts` owns the child,
stdin/stdout requests, deadlines, and cancellation; `descriptor-directory-protocol.ts`
validates wire DTOs. Main-process wiring must pass absolute trusted resource
paths and registered roots from the existing catalog authority. The bridge is
not a new root registry and does not accept a path from a browse request.
The bridge loads `config/scripts/data-catalog/native-root-identity.py` from an
absolute sibling path derived from the bridge script's own `__file__`; it does
not import through the caller's working directory or `sys.path`. Packaging
must include both script files together. The provider accepts an already-open
directory descriptor and returns only native identity metadata.

The child accepts newline-delimited JSON requests, each limited to 64 KiB, and
returns bounded JSON responses. Its operation allowlist includes `capabilities`,
`open_root`, `verify_root`, `lstat_child`, `open_child`, `verify_child`, `read`,
`stat_preview`, `read_preview_chunk`, `close`, and `shutdown`. The only content
operation is `read_preview_chunk`: it requires a previously opened root handle,
server-supplied relative components and expected stat version, and returns at
most 16 KiB. There is no arbitrary-path read, shell, command execution, or
write operation. It accepts at most 256 open directory
handles, 64 nested components, 4 KiB root paths, and 255-byte UTF-8 path
components. Names are passed as individual POSIX components: backslash remains
ordinary filename data, and Unicode is not normalized by the bridge. The
explicit filesystem root `/` is accepted by path validation. It can be
registered only when the selected native provider returns a usable incarnation
proof; a zero or unavailable token remains unsupported. On a supported volume,
its descriptor can be opened and closed without enumerating its contents.

The Python side refuses non-POSIX hosts or hosts missing `dir_fd`, no-follow,
and descriptor-scandir support. It opens each root component and child with
`O_DIRECTORY | O_NOFOLLOW`, obtains identity with `fstat`, and verifies the
parent-relative name after opening. It uses `stat(..., dir_fd=..., 
follow_symlinks=False)` for entries. Symlinks, FIFOs, and special files are
reported as types and are never traversed. Each child handle retains its
parent/name chain; before later reads or stats, the bridge checks the root
registration path and every parent-relative identity again.

Root registrations also carry a native incarnation proof. Linux is supported
only on ext4: the provider checks `fstatfs` magic `0xef53`, reads the filesystem
ID and inode generation with `FS_IOC_GETVERSION`, and rejects missing, zero,
or malformed values. macOS is supported only on APFS: `fgetattrlist` on the
already-open descriptor must return the exact requested attributes, a nonzero
volume UUID, and the APFS filesystem name; the full-width inode/file ID is the
incarnation token. Other operating systems and filesystems fail closed. No
timestamp is used as an identity fallback, and the provider performs no marker
writes or `SETVERSION` operation.

These are practical guarantees for the named providers, not a claim that
identities survive privileged filesystem restoration. Linux's 32-bit inode
generation can be changed by privileged `FS_IOC_SETVERSION`, and raw filesystem
restore can replay it; APFS snapshots or privileged image rollback can likewise
replay filesystem metadata. Such operations are outside the supported normal
filesystem lifecycle and require re-registration.

The Node adapter starts Python with isolated, bytecode-disabled flags (`-I -B`).
On ordinary disposal it sends `shutdown`; the child closes its
iterators and descriptors before exiting. Cancellation, malformed or
oversized protocol data, child failure, and request deadline reject every
pending request and kill only the child owned by that adapter instance. A late
reply from a terminated child cannot construct a Node directory handle; process
exit closes any kernel descriptors that remain. Shutdown and cancellation
waits are bounded; `cleanupConfirmed` reports whether child exit was observed
and stays false if the child has not been confirmed gone. After a failed helper
epoch, a later root capture/open may start a fresh transport only after that
epoch's child exit is confirmed. It never overlaps an unconfirmed child.
Directory handles remain bound to their creating transport; IDs from a dead
epoch are never sent to a replacement helper. Global disposal and
dispose-before-start are terminal and cannot create another epoch. The bridge
retains only its current transport; it drops the previous transport reference
only after confirmed exit. An unconfirmed child remains current and blocks
replacement.

The bridge exposes the main-process-only synchronous
`previewHelperEpoch(): string | null` required by the catalog preview authority.
It is `null` before a helper is running and immediately after deadline,
cancellation, disposal, unexpected exit, unsupported-platform selection, or
any other unavailable/closing state. While the child is alive it returns a
stable opaque per-transport token; a recovered child gets a new token only
after the previous child exit is confirmed. Tickets and in-flight preview
operations bind that token and refuse results if it changes. The token is not
an RPC parameter or filesystem identity and grants no preview permission.

## Integration status

This is an adapter candidate only. Runtime/resource packaging and catalog
service injection remain ROOT-owned follow-up work. Until that wiring supplies
the trusted Python and script paths and chooses the adapter, the existing
default filesystem continues to refuse scans with
`race_safety_unavailable`; do not treat this source slice as deployed or as
production scan acceptance.

## Explicit registered-root preview operations

`descriptor-preview-contract.ts` defines strict `NativePreviewIdentity`,
`NativePreviewStat`, and `NativePreviewChunk` DTOs and the bridge limits: 256
KiB per file and 16 KiB per raw chunk. The bridge API is
`statPreview(root, openedRoot, components)` and
`readPreviewChunk(root, openedRoot, components, expectedStat, offset, length)`.
Both require the live root handle returned by `openRoot`; a child directory
handle, untrusted absolute path, caller-selected identity, or malformed
component list is refused. `statPreview` opens the final item nonblocking and
no-follow, verifies it is a regular file on the registered root device, and
returns only full-width decimal stat fields. It does not return file bytes.

`read_preview_chunk` validates the expected stat version and exact chunk range,
walks parent components descriptor-relatively with no-follow directory opens,
and opens the final file with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`. Before and
after `pread`, it checks the opened descriptor, final parent-relative name,
each opened parent name, and the opened root's registered incarnation. Any
file, parent, or root identity change refuses the result; every temporary
descriptor closes on all paths. The raw `dev`, `ino`, `sizeBytes`, `mtimeNs`,
and `ctimeNs` values remain canonical decimal strings, including values
beyond JavaScript's safe integer range.

`lstat_child` carries an optional private `previewIdentity` on regular-file
stat responses when all fields fit the strict nonnegative U64 contract. It
retains decimal `dev`, `ino`, byte size, nanosecond modification/change times,
and the regular-file discriminator while leaving
the public metadata entry unchanged. The catalog service can retain that value
in its server-owned row witness; it is never a path or content value.

`fileVersion` is an opaque SHA-256 stat-version token, not a content hash. Both
languages use the domain `dobius:data-catalog:preview-stat:v1\0`, followed by
each UTF-8 field framed as a four-byte big-endian byte length and its bytes.
The field order is root ID, registration generation, root device/inode, native
incarnation provider/scope/token, component count, each
exact component, file device/inode/size/mtime-nanoseconds/ctime-nanoseconds,
and `regular`. It does not prove backup integrity or detect a privileged actor
that restores all observed stat fields. Content access remains opt-in at the
higher catalog service: listing stays metadata-only, and this native bridge
does not imply RPC authorization, a UI, or live acceptance.

The existing transport deadline and confirmed-child-exit fence also apply to
preview calls. A timeout or malformed reply cancels that owned child; another
helper epoch cannot replace it until exit is confirmed. Unsupported POSIX
hosts and Windows continue to fail closed.

## Verification

From the `dobius/` application directory, run the hermetic Python suite with
`python3 -B -m unittest -v config/scripts/data-catalog/test_descriptor_directory_bridge.py`.
Run the adapter integration suite with Node 24 and one Vitest worker:

```sh
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts \
  src/main/storage/data-catalog/descriptor-directory-bridge.test.ts \
  src/main/storage/data-catalog/descriptor-preview-contract.test.ts \
  src/main/storage/data-catalog/descriptor-directory-transport.test.ts --maxWorkers=1
```

The Python tests exercise native provider identity and replacement behavior,
unsupported-filesystem refusal, real temporary roots, root and child symlinks,
FIFO refusal, rename detection, path-component preservation, bounded protocol
input, handle closure, and EOF cleanup. The Node tests run the actual bridge
adapter on temporary roots. Preview fixtures verify full-width stat strings,
cross-language stat-version agreement, ordered chunks, stale-version refusal,
FIFO/symlink/directory/oversize refusal, and deterministic final-name
replacement during a read. The adapter tests also exercise symlink/FIFO and
rename behavior, and use
disposable stub children to verify deadlines, pending-request rejection,
malformed-response handling, cancellation, confirmed-epoch recovery,
unconfirmed-exit refusal, repeated recovery without retained epochs,
stale-epoch handle rejection,
disposal-before-start refusal, and owned-child termination. The adapter suite
also verifies cross-instance handle rejection and malformed `read` and
verification result refusal.

## Python API references

- [`os.open`](https://docs.python.org/3/library/os.html#os.open) supports
  directory-descriptor-relative operations where the platform provides them.
- [`os.supports_dir_fd` and `os.supports_follow_symlinks`](https://docs.python.org/3/library/os.html#os.supports_dir_fd)
  expose host capability checks; Python documents `dir_fd` as Unix-only.
- [`os.stat`](https://docs.python.org/3/library/os.html#os.stat) accepts
  `dir_fd` and `follow_symlinks=False` on supporting hosts, while
  [`os.fstat`](https://docs.python.org/3/library/os.html#os.fstat) returns
  identity from the opened descriptor.
- [`os.scandir`](https://docs.python.org/3/library/os.html#os.scandir) accepts
  a directory descriptor on Unix and its iterator should be explicitly closed.
