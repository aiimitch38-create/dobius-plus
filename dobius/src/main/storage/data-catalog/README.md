# Read-only registered data catalog

This domain provides a fixture-testable metadata scan over roots supplied by an
injected `RegisteredCatalogRootProvider`. The provider resolves a trusted
main-process principal and root ID through existing browse permission. Requests
contain no filesystem path, and job, artifact, or storage-monitor authority is
not a substitute for browse permission. The application factory supplies one
catalog singleton to Settings/Knowledge, desktop IPC, and authenticated runtime
RPC. Registration requires an explicit local native chooser; paired-phone reads
require separate root grants. This core does not automatically register or scan
production roots. Source composition is separate from packaged/live acceptance;
see [the application contract](../../../../docs/reference/DATA-CATALOG-APPLICATION.md).

The strict renderer/RPC entry and page DTO validators live in
`src/shared/data-catalog-schema.ts`; this main-process module re-exports those
same schemas and inferred types from `types.ts` so both sides share one shape.

The scanner requires a `MetadataFileSystem` adapter that opens the registered
root, opens each child relative to its already-open parent without following
links, returns identity from the opened descriptor, and rechecks every named
component against that identity. Stock Node's public path-based `fs` API cannot
prove that a `Dir` handle is the object reached by separate `lstat` calls, so
the default adapter refuses scans with `race_safety_unavailable`. A narrowly
scoped platform/native descriptor adapter is required before production roots
can be browsed; pathname checks are not treated as a substitute. Provider and
filesystem operations are deadline-bound, late directory handles are closed,
and service close aborts and drains active requests.

Root authorization requires a native incarnation identity in addition to
`dev` and `ino`; creation time is optional diagnostic metadata and is never an
authorization token. Linux identities use `linux-inode-generation-v1` with a
16-character lowercase hexadecimal filesystem scope and a positive canonical
decimal 32-bit inode-generation token. Darwin identities use
`darwin-apfs-file-id-v1` with a 32-character lowercase hexadecimal APFS volume
UUID scope and a positive canonical decimal 64-bit file-ID token. The provider,
scope, and token must match exactly. Missing or unusable native proof refuses
authorization; there is no fallback to birth time, ctime, or pathname checks.
The main-process metadata filesystem may supply a bounded
`captureRootIdentity(path)` reader. Without it, authorization is unavailable.
Legacy registrations without native incarnation must be explicitly re-enrolled,
and enrollment must not carry device grants across a changed native token.
Creation-time timestamps remain useful for diagnostics only; equality between
`birthtimeNs` and `ctimeNs` is valid and says nothing about native-token support.

The descriptor bridge projects root incarnation proof separately from opened
directory handles. Each live handle still uses its own `dev`/`ino` identity,
which is pinned by the open descriptor. The native `open_root` and
`verify_root` operations carry and check the full root provider/scope/token;
child-stat and opened-handle identity DTOs remain `dev`/`ino` only. A token must
come from the actual supported native filesystem API, not from an inferred
timestamp or a test-only counter.

Traversal reports the exact filesystem component spelling in each root-relative
`relativePath` and `name`; NFC normalization is used only for stable SHA-256
identity and ambiguity checks, so a unique NFD filename still addresses its
actual physical path. Entries include kind, bounded filesystem metadata, and a
stable identifier derived from the root ID and normalized relative path. Entry `observedAtMs` uses wall-clock epoch
milliseconds; traversal budgets and session TTL use the injected monotonic
clock. Slash separates path components; a literal POSIX
backslash remains component data. NFC-equivalent and case-fold-equivalent
normalized paths stop the scan with `ambiguous_path`, no entries from the
ambiguous page, and no continuation cursor. If the ambiguity is discovered
after an earlier page, the caller must discard the incomplete catalog. The
scanner never opens or reads file contents, so `contentDigestSha256` is always
`null`, backup coverage is `unknown`, and no archive, recovery, cleanup,
reclaimable-space, or eviction claim is made. Original Markdown remains
authoritative and is never copied, parsed for frontmatter, rewritten, or
shadowed by a writable catalog.

The scanner uses bounded depth-first traversal with page, entry, operation,
depth, frontier, elapsed-time, response-byte and 2 MiB directory-name-buffer
limits. It validates and sorts a directory's names before emitting its children,
so normalized sibling collisions are refused even when a page would otherwise
stop after the first spelling. A component exceeding the filesystem's 255-byte
name limit is rejected as a bounded scan failure. It skips symlinks and
special files, refuses mount/device changes, verifies opened-handle and
component identities, and closes handles on completion, cancellation,
expiration, timeout, root change, or service close. Continuation cursors are
random and single-use, bound to principal, root, registration generation and
directory identity. Pending scans reserve capacity before authorization; a
cursor is consumed before any awaited continuation work. Cursors and handles
live only in a bounded in-memory map and expire; this is not a persistent
file/task database.

Results are `complete`, `partial`, `denied`, or `unavailable`. Partial results
never imply a complete inventory or verified backup coverage. Tests use empty
temporary root identities and a deterministic descriptor-capable in-memory
filesystem fixture; they do not claim that the host Node adapter can provide
the required native handle guarantee. No production vault is scanned and no
file bytes are requested. Native bridge, enrollment, and application integration
tests also exercise disposable real APFS/Linux roots and staged helper resources;
they do not authorize a production vault scan. Content preview has no catalog
API yet and requires a distinct grant and descriptor-backed read boundary. The
existing worktree file reader does not authorize registered-root content.
