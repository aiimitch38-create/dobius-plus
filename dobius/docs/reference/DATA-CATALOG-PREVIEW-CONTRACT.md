# Registered-root original preview contract

Date: 2026-10-14  
Status: Accepted contract with a corrected FIXER backend candidate awaiting renewed independent review; not a package or live-acceptance claim.  
Scope: Explicit, read-only preview of a catalog-listed Markdown or text file from a registered root. This contract does not authorize reading any production note or original file during development or review.

## Existing boundary and governing rules

The existing `data.catalog.roots` and `data.catalog.page` metadata API remains behaviorally unchanged: it lists safe labels and file metadata, returns no file bytes, and never opens an editor or changes the selected host/worktree. Existing deterministic `entryId` is a locator for list rows, not a secret or authorization token. Existing `files.readPreview` remains worktree-scoped and is not a fallback for registered roots.

Preview is a separate capability. Browsing permission never implies preview permission. Persist a per-root `desktopPreviewEnabled` boolean and a separate `allowedPreviewDeviceIds` set. Both default to false/empty for new roots and legacy roots; migration never copies, infers, or upgrades old `allowedDeviceIds`. The trusted local policy view may show all eligible paired mobile devices while desktop preview is disabled, so the user can grant separate consent. A phone needs current browse and preview grants, a currently paired device registered as `mobile` scope, a supported authenticated connection, and an explicit Preview action. Local desktop preview needs authenticated local UI authority, that root's `desktopPreviewEnabled` opt-in, and an explicit Preview action. No principal, device ID, host ID, path, or authorization claim comes from request parameters.

The server sends bounded raw file bytes as base64 chunks before the client can validate the complete file. The client renders no text until all chunks are assembled in order, the complete byte count and final server completion are verified, fatal UTF-8 decoding succeeds, and `finish` grants visibility. This does not claim the server prevents binary bytes from crossing the transport. Neither side writes or persists preview content, sends it to an agent/Laya/provider, includes it in telemetry or error logs, or exposes it through the metadata catalog. Closing, switching host/root/generation/connection, disconnecting, denying, expiring, or revoking clears UI memory. Delivered bytes cannot be recalled from a client; invalidation plus a short display lease bounds visible stale content after the server learns of revocation.

## Principals, grants, and server-owned identity

The RPC boundary constructs a principal from authenticated transport state:

```ts
type CatalogPreviewPrincipal =
  | { kind: 'local-webcontents'; principalId: 'desktop'; connectionId: string; hostId: string;
      webContentsId: number; navigationId: string; destroyedOrNavigated: AbortSignal }
  | { kind: 'paired-mobile'; principalId: `device:${string}`; deviceId: string;
      connectionId: string; hostId: string; scope: 'mobile'; destroyedOrNavigated: AbortSignal }
```

All identity fields are derived by main from authenticated transport state. WebSocket clients use the existing authenticated `clientKind` and `connectionId` context plus server-verified mobile device scope. For desktop IPC, `authenticatedLocal` alone is insufficient: main owns a stable trusted WebContents/top-frame navigation-incarnation ID and an abort signal for navigation or destruction. Reuse this identity across calls within that navigation; rotate it and abort outstanding work on top-frame navigation or WebContents destruction. Do not mint a new identity per IPC request. A runtime-scope token, missing/incorrect mobile scope, unauthenticated peer, stale connection, or caller-supplied principal is denied. Paired-device identity alone is not proof of a human UI.

Unix CLI sockets are per-request transports, not preview UI sessions; return typed unsupported/unavailable because they lack a stable supported UI identity. Do not introduce a global desktop ID workaround. Remote desktop runtime-scope environment tokens also remain denied for preview.

Persist mobile grants separately as `allowedPreviewDeviceIds`. Only the trusted authenticated local WebContents UI may invoke strict `data.catalog.setPreviewAccess({ rootId, desktopPreviewEnabled, deviceIds })`; Unix CLI and remote/runtime principals cannot invoke it. The schema rejects extra or missing fields. This mutation sets the local per-root boolean and the independent paired-mobile device set without changing browse grants. Legacy and new roots start false with no device preview grants. Only current paired devices with verified `mobile` scope can be added. Unpairing, revoke, root replacement, generation rotation, connection navigation, or destruction invalidate active references and sessions. The consent copy is `Allow text previews on this computer.` Companion copy: `Only files you explicitly preview are read. Text stays in this view and is not sent to agents.` The mobile section says `Allow text previews on selected paired phones; requires browse access separately.`

## Domain interface and RPC shape

The main-process domain service owns resolution, authority checks, references, ordered sessions, helper calls, and invalidation. Schemas are strict discriminated unions. Request DTOs contain no absolute path or principal. The RPC adapter derives the principal from trusted context and passes it separately to the service.

```ts
type PreviewFileVersion = string // canonical lowercase SHA-256 hex, opaque stat-version token

type PreviewResolveRequest = {
  rootId: string; generation: string; entryId: string
}
type PreviewResolveResult =
  | { state: 'ready'; entryRef: string; rootId: string; generation: string;
      fileVersion: PreviewFileVersion; sizeBytes: string; expiresInMs: 30000 }
  | { state: 'denied' | 'changed' | 'unsupported_type' | 'too_large' |
      'expired' | 'busy' | 'unavailable' }

type PreviewStartRequest = { entryRef: string }
type PreviewStartResult =
  | { state: 'ready'; previewSessionId: string; rootId: string; generation: string;
      fileVersion: PreviewFileVersion; totalBytes: string; chunkBytes: 16384; expiresInMs: 60000 }
  | { state: 'denied' | 'changed' | 'expired' | 'busy' | 'unavailable' }

type PreviewChunkRequest = { previewSessionId: string; offset: number }
type PreviewChunkResult =
  | { state: 'chunk'; previewSessionId: string; rootId: string; generation: string;
      fileVersion: PreviewFileVersion;
      totalBytes: string; offset: number; nextOffset: number; final: boolean;
      dataBase64: string }
  | { state: 'changed' | 'denied' | 'expired' | 'invalid_offset' |
      'busy' | 'unavailable' }

type PreviewFinishRequest = { previewSessionId: string; fileVersion: PreviewFileVersion }
type PreviewFinishResult =
  | { state: 'visible'; leaseTtlMs: number }
  | { state: 'changed' | 'denied' | 'expired' | 'incomplete' | 'unavailable' }

type PreviewRenewRequest = { previewSessionId: string; fileVersion: PreviewFileVersion }
type PreviewRenewResult = { state: 'visible'; leaseTtlMs: number }
  | { state: 'changed' | 'denied' | 'expired' | 'unavailable' }

type PreviewCloseRequest = { previewSessionId: string }
```

Concrete methods are `data.catalog.preview.resolve`, `.start`, `.chunk`, `.finish`, `.renew`, and `.close`; `data.catalog.setPreviewAccess` is an authenticated-local-only mutation with strict `{ rootId, desktopPreviewEnabled, deviceIds }` input. The preview read methods may be mobile-allowlisted only as transport permissions. The domain service still verifies principal scope and both grants on every operation. The grant mutation is never mobile-allowlisted. Keep existing roots/page request and result schemas intact; any internal tracking needed to prove page membership is server-owned and does not add a caller path or expose a canonical root path.

`resolve` is called only after an explicit user click. It requires that the exact `(principal, connection, rootId, generation, entryId)` was emitted in a still-valid metadata page for that principal/connection. The server stores a bounded, short-lived listing ledger bound to the exact authenticated connection that emitted each row, containing the exact physical component sequence and native stat identity associated with emitted rows. It verifies the entry is a regular `.md` or `.txt` file, confirms the version again through the native bridge, and mints a cryptographically random, single-use entry reference. Forged deterministic IDs, rows not emitted by the catalog, caller-substituted paths, and stale versions fail without a content read. The entry reference is bound to principal, connection, host, root ID and native incarnation, registration generation, entry ID, exact components, file version, and expiry. It is memory-only and never logged.

`start` atomically consumes the entry reference, repeats authority/version validation, and creates a server-owned session. Session state includes the principal/connection/host, root/incarnation/generation, exact components, file version, total byte count, next expected offset, active operation flag, deadlines, and lifecycle state. Only one chunk operation may run per session; duplicate, concurrent, skipped, reordered, or cross-session offsets are rejected. Reserve session and global operation capacity synchronously before any await. The four active native-operation slots include authenticated root authorization as well as native stat/read work; resolve, start, chunk, finish, and renew each reserve a slot before their first awaited authorization or native call and release it only after those checks settle. Cap one preview session per principal and four active native operations service-wide; bound pending references and expire them. The entry-reference TTL is 30 seconds and transfer-session window is 60 seconds. Replies carry fixed relative `expiresInMs` values plus root ID and generation for client binding. These limits are ROOT-confirmed contract values.

`finish` is required after the client has received every contiguous chunk and performed fatal UTF-8 decoding. It is a one-time session transition: once finish starts, or a visibility lease has ever been issued, that same session cannot issue another finish lease, even after its 30-second display lease expires. A repeated finish invalidates the session before another native or authorization await; the final synchronous ticket/session check also refuses any session whose visibility was already issued. To preview the file again, the user must make a fresh explicit Preview action and receive a new reference/session. Finish rechecks root identity/generation, grants, pairing and native file version before allowing rendering, then returns a bounded relative `leaseTtlMs` no greater than 30 seconds. The client records the local monotonic start time of the `finish` request and computes its conservative expiry from that start, never from response receipt or a server wall-clock timestamp. It accepts the finish response only if the response arrives before that locally computed expiry; otherwise it discards the response and assembly without rendering. Renew every 10 seconds while visible. A renew request starts only before the current locally computed expiry; the client computes the proposed expiry from the local monotonic start of that renew request, capped at 30 seconds, and accepts it only if the response arrives before both the existing lease expiry and the proposed new expiry, and the preview is still active. A late response cannot extend or revive an expired lease. Backgrounding, disconnect, navigation, or loss of connection clears content and requires a fresh explicit Preview action. Server-side revoke, unpair, root replacement, or generation change invalidates sessions and sends a content-free `data.catalog.previewInvalidated` event to the bound connection. Missed events are bounded by the client lease. `close`, disconnect, error, event invalidation, or lease expiry destroys server state. No event includes a path, filename, chunk, or content.

At request entry, the main-process authority owner synchronously captures an immutable authority ticket/epoch covering only main-owned authority: root registration/generation and grants, verified pairing/scope, connection lifecycle, and helper incarnation. Every main-owned mutation to those authorities increments the shared epoch synchronously before publishing the mutation or invalidation. External note editors do not participate in or advance this epoch. After each awaited registry/native operation, and at the final commit point, compare the captured ticket with current main-owned authority synchronously; if it differs, discard the result. The final epoch comparison, session/offset state commit, and response decision must run without an intervening `await`, so revocation cannot land between an async source check and a later gate check. Apply this to chunk return and visible-lease creation/renewal, as well as reference consumption. If the authority store cannot provide this in-process mutation epoch or equivalent serialized ticket, refuse preview rather than use a separate asynchronous check-then-act sequence. Chunk output is committed only if the ticket, session, and expected offset still match. Native root/file stat checks are observed identity/version proofs at their documented read points; they do not make file contents immutable or guarantee detection of a privileged actor that can restore metadata. Already delivered content cannot be recalled. UI also checks a monotonically increasing request token and host/root/generation/connection identity before accepting each response and before revealing assembled text.

## Native stat-version and descriptor read

Do not change the existing metadata page wire contract to add file bytes or absolute paths. The scanner/native adapter may retain additional private stat data in the server-owned listing ledger. Add a strict native metadata record for preview eligibility/versioning:

```ts
type DecimalU64 = string // /^(0|[1-9][0-9]*)$/, range checked as BigInt

type NativePreviewStat = {
  dev: DecimalU64; ino: DecimalU64; sizeBytes: DecimalU64;
  mtimeNs: DecimalU64; ctimeNs: DecimalU64;
  fileType: 'regular'; fileVersion: PreviewFileVersion
}
```

The native helper must serialize full-width `dev`, `ino`, size, `mtime_ns`, and `ctime_ns` as canonical decimal strings; never round nanoseconds through a JS `Number`. `fileVersion` is SHA-256 over an unambiguous, domain-separated, length-prefixed representation of root ID/incarnation, registration generation, exact filesystem component bytes, device/inode, size, `mtime_ns`, `ctime_ns`, and file type. It is an opaque stat-version, not a content digest, backup proof, or protection against a privileged actor restoring metadata. Preserve exact original filesystem spelling, including NFD names and literal POSIX backslashes.

Add one strict `read_preview_chunk` descriptor-helper operation using a previously opened, verified root handle. Walk each relative component descriptor-relatively with no-follow directory opens; reject empty, `.`, `..`, NUL, absolute paths, repeated separators, symlinks, mount/device changes, and unsupported files. Open the final component with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, then `fstat` it and require a regular file on the enrolled device. Compare its descriptor identity/version with the server-owned expected version, use bounded `pread`, and recheck both descriptor and named parent-relative identity/version after the read. Close every descriptor in `finally`. FIFO, socket, device, directory, symlink, cross-mount, replaced parent, or changed version returns a bounded typed refusal; never fall back to path-only Node reads.

Use the existing owned-helper transport's timeout kill and confirmed-exit tracking. A helper timeout/disconnect aborts the operation; do not start another helper or reuse the root handle while the prior child exit is unconfirmed. If cleanup cannot be confirmed, keep preview unavailable until confirmed cleanup/recovery. No overlapping helpers, descriptors, or stale transport generations may return bytes.

The protocol is POSIX-specific. Windows returns typed unsupported/unavailable under the existing POSIX native boundary; there is no unsafe fallback and no Windows-native implementation in this phase.

## Byte, rendering, and privacy rules

Base64 chunks are a transport encoding of raw file bytes, not validated text. They may reach the client before whole-file validation. The guarantee is zero partial text rendering or content persistence: the UI assembles the exact ordered file, verifies final completion, performs fatal UTF-8 decoding, then calls `finish` and reveals text only if that final authorization succeeds.

- Only `.md` and `.txt` regular files are eligible; maximum complete file size is 256 KiB. Larger files return `too_large` with no session content.
- Each helper/RPC chunk contains at most 16 KiB raw bytes. Strict base64 must be canonical and decoded length must equal the declared range. Entire serialized response stays below 64 KiB. Total size/offsets are checked without unsafe integer coercion.
- Session offsets begin at zero and advance exactly by decoded byte length. Require a stable version and total size on every chunk, exact final byte count, and no gaps, repeats, reorder, or interleaving. Each helper operation has a 1-second deadline; the entry reference TTL is 30 seconds, transfer session is 60 seconds, visible lease is 30 seconds, and the client renews every 10 seconds.
- The client holds bytes only in bounded volatile memory, concatenates them in order, and performs fatal UTF-8 decoding once the exact final byte count is reached. UTF-8 multibyte sequences may cross chunk boundaries. Invalid UTF-8, binary content, cancellation, mismatch, timeout, truncation, denial, or stale state discards the entire assembly. No partial text is rendered, even briefly.
- The first implementation displays escaped inert plain text; Markdown is shown literally. No HTML, scripts, links, automatic linkification, images, previews, remote resources, or external viewer. Any richer rendering requires a later explicit security review and approval.
- Do not persist or cache text in the catalog, settings, journal, crash reports, analytics, RPC interaction logs, Laya/advisory inputs, agent context, queue, event payloads, or clipboard. Errors and telemetry carry only bounded reason codes and opaque operation IDs; no filename, relative path, absolute path, bytes, authorization token, or user content.
- Desktop and phone preview remain inline in the chosen host/root view. Do not navigate to a different host/worktree, activate a terminal/editor/tab, or mutate active selection. Clear volatile assembly/text on host/root/generation/connection change, stale response, revoke/unpair, close, denial, disconnect, lease expiry, or component unmount.

## Ownership and file split

Preserve existing metadata APIs and limit the new code to dedicated preview seams. ROOT must assign the final overlapping paths before any implementation.

| Owner | Proposed paths and responsibilities |
|---|---|
| BUILD2 native bridge | `dobius/config/scripts/data-catalog/descriptor-directory-bridge.py` and its fixture tests; add `read_preview_chunk`, no-follow/nonblocking descriptor operations, exact stat-token DTO, bounded response and process cleanup coverage. Extend `descriptor-directory-protocol.ts`, `descriptor-directory-transport.ts`, and `descriptor-directory-bridge.ts` only if ROOT assigns their shared ownership. |
| Main catalog/application owner | `dobius/src/main/storage/data-catalog/types.ts`, `metadata-scanner.ts`, `catalog-session-lifecycle.ts`, `catalog-service.ts`, `root-enrollment-store.ts`, `application-catalog.ts` and focused tests; preserve page API while tracking server-emitted rows, separate legacy-safe preview grants, issue/consume bound refs, manage sessions/leases, recheck authority, and clear on lifecycle events. |
| RPC/auth owner | `dobius/src/shared/data-catalog-schema.ts`, `data-catalog-roots.ts`, `dobius/src/main/runtime/rpc/methods/data-catalog.ts`, dispatcher/context and mobile method/grant tables with tests; strict DTOs, server-derived mobile scope/connection identity, local-only grant mutation and invalidation event. Do not allowlist the mutation. |
| BUILD1 both-app UI | Existing Knowledge/Settings and phone Files catalog UI paths, including their reader-state helpers/tests; add explicit preview and per-device permission controls, validate strict DTOs, assemble/fatal-decode completely, render only after `finish`, keep host/root selection unchanged, renew/clear leases and reject late responses. Do not route through QuickOpen or worktree `files.readPreview`. |
| Documentation | This contract first; then update `DATA-CATALOG-APPLICATION.md`, `DATA-CATALOG-DESCRIPTOR-BRIDGE.md`, registration docs and UI docs under their owners. Distinguish implementation/test evidence from installed or production evidence. |

Coordination facts from the latest preflights: BUILD1's both-app surfaces were metadata-only before the separately owned UI implementation. BUILD2's corrected native bridge source now provides preview stat/chunk operations and helper-incarnation checks with bounded cleanup/no-overlap behavior. The accepted C07 catalog, registration, and native root-incarnation work remain prerequisites and are not replaced by this contract.

## Required verification matrix

| Boundary | Required synthetic test evidence |
|---|---|
| Legacy grants and principal | Missing `allowedPreviewDeviceIds` stays denied despite existing browse grant; both grants and paired mobile scope required; runtime-scope device, unpaired/revoked device, forged principal, stale connection and remote grant mutation denied. Local action is explicit. No fallback to worktree preview. |
| Entry reference | Forged/unlisted `entryId`, replay by another principal/connection/root generation/incarnation, expired or consumed ref, substituted path/version, and wrong host fail before helper content read. Only an entry actually emitted by the catalog can resolve. |
| Revocation and lease races | Delay authorization/native stat/read, then revoke, unpair, remove/replace root, change generation or disconnect; after release return no chunk/finish lease and clear UI. Delay `finish`/renew responses beyond the local monotonic deadline and verify no late response can extend or revive preview. Test wall-clock skew, expiry before a renew attempt, renewal response after expiry, and background/disconnect/navigation clearing with fresh explicit action required. Delayed old-host response must not focus or alter the new selection. |
| Native race resistance | Temporary synthetic files only: regular-file success; rewrite same length changes ordinary mtime/ctime version; inode/path replacement; root-generation change; NFD component and literal backslash; symlink, FIFO raced immediately before open, socket/device/directory, cross-device mount, replaced parent and mutation during `pread`. FIFO refusal must be prompt with no blocked helper. |
| Helper lifecycle | Ignore cancellation or exceed deadline: caller settles boundedly, owned child is terminated, capacity stays occupied until observed exit, no overlapping helper starts; unconfirmed exit blocks recovery. Disposal cancels pending work and closes every descriptor. |
| Chunk assembly | Empty file, exact 16 KiB boundaries, final partial chunk, exact 256 KiB, 256 KiB+1; max response below 64 KiB; canonical base64 and declared length; malformed base64, duplicate/skipped/reordered/concurrent offsets, mixed version/size, invalid UTF-8 and split multibyte UTF-8. Any failure yields zero rendered text. |
| Privacy and focus | Test logs/interaction diagnostics contain no filename/path/token/bytes; catalog and journal remain unchanged by content; agent/Laya inputs receive nothing; no automatic read at list time; host/worktree/tab/terminal selection remains unchanged; close, revoke, expiry and unmount clear complete and partial buffers. |
| Compatibility and claims | Existing roots/page contract regression stays unchanged; old host/missing method returns unavailable/unsupported without `files.readPreview` fallback. Tests use temporary synthetic fixtures only and do not read original notes. Report source tests separately from packaged, live, or user acceptance. |

## Resolved decisions and remaining implementation gates

ROOT resolved the per-root local preview opt-in, separate paired-device grants, consent strings, TTLs, transport support, and platform behavior described above. The 30-second reference TTL, 60-second transfer window, 30-second display lease, 10-second renewal interval, 1-second helper deadline, 16 KiB chunk, 256 KiB complete-file cap, under-64-KiB response, and four-read ceiling are fixed contract values.

BUILD1's latest read-only both-app preflight (`build1.json:c07_both_app_preview_preflight`) confirms the current desktop and phone surfaces are metadata-only, host/root keyed, and preserve focus when used inline; it identifies no preview implementation. Its constraints are reflected here: explicit click only, separate grants, full assembly before render, stale-response fences, no automatic reads, and no host/terminal focus changes.

BUILD2's corrected native bridge source exposes the strict identity/stat/chunk contract, descriptor `stat_preview`/`read_preview_chunk` operations, bounded child cleanup, no-overlap behavior, and the synchronous helper-incarnation epoch required by the FIXER facade. The main factory wires the epoch callback and targeted invalidation emitter; ROOT's native factory/client fixture passes its eight focused tests. BUILD2's current bridge freeze has RESEARCH PASS, while Linux/package/runtime acceptance remains separate. Only authenticated-local UI and server-verified mobile WebSocket scope are supported; per-request Unix CLI and remote runtime-scope desktop remain denied.

No original-note bytes have been read for this contract. No production scan, note ingestion, archive/upload, install, or live integration is implied.

## FIXER source implementation boundary (2026-10-14)

The FIXER source slice implements strict DTOs in `src/shared/data-catalog-preview-schema.ts`, default-off independent registration grants, a trusted-principal type, an in-memory emitted-row witness ledger, bounded single-use references, ordered transfer sessions, and final/renewed visibility leases. The main facade exposes policy, grant, resolve, start, chunk, finish, renew, close, and connection/authority invalidation methods. Local policy is available while desktop preview consent is off and lists eligible paired mobile devices; content operations still require the local opt-in or the paired mobile preview grant plus browse authority. The local-only grant mutation accepts exactly `{rootId, desktopPreviewEnabled, deviceIds}`.

The server-private ledger retains exact physical path components and the full native row identity/version only for entries both eligible and actually emitted in that metadata page. Resolve re-stats the listed file before minting a reference. Start, each chunk, finish, and renew verify the descriptor-backed root and file version; opened-root handles close before final synchronous authority, offset, or visibility commit. Admission slots are reserved before the first awaited authorization/stat operation. Shutdown refuses new work, invalidates active state, and drains bounded operations before the owned bridge is disposed. Preview-service modules are split by state, authority, maintenance, start, transfer, and public facade, each at or below 300 TypeScript lines.

The metadata adapter exposes the native bridge's synchronous helper-incarnation accessor as `MetadataFileSystem.previewHelperEpoch()`, alongside `statPreview` and `readPreviewChunk`. If the accessor or either native method is absent, the scanner does not issue preview witnesses and the service refuses preview. The current main factory supplies the callback and the targeted invalidation emitter; transport principal construction/invalidation and both application clients remain separate integration gates. Source tests do not establish a packaged, installed, or user-visible preview experience.

The corrected FIXER backend source reserves bounded global operation capacity before the first awaited authorization or native operation, including policy and every preview operation. Four native-operation slots cover root authorization as well as native open/stat/read checks; resolve, start, chunk, finish, and renew release slots only after those awaited checks settle. It re-stats the exact emitted physical witness before minting a reference and rechecks the native version before the visible lease. Open-root handles are closed before the final synchronous authority/state decision. Invalidation fan-out is keyed by connection, root, and generation; a connection with content on one root and a live listing on another receives both root-scoped invalidations. Finish is one-shot per session: a prior finish attempt or issued visibility lease, even an expired one, cannot mint another lease in that session. `withVerifiedRoot` compares the captured helper epoch immediately after `openRoot` resolves, before root verification or stat work.

The corrected focused Node 24 suite passes 8 files / 91 tests; targeted node typecheck, lint, and formatting pass for the changed backend paths. The tests use temporary synthetic fixture data and include repeated finish before/after lease expiry, wall-clock forward/rollback, delayed helper-open epoch replacement, and four-slot saturation during delayed resolve authorization. This is source-level verification only, not installed-client or physical preview acceptance.

BUILD2's independent bridge review and ROOT's synthetic native factory/client checks are recorded in the current `build2.json` and ROOT delivery reports. The corrected FIXER backend review is recorded in `plans/cloud-workstation-reports-20261012/fixer.json` under `c07_preview_implementation`; its new exact file hashes and focused test results supersede the historical `63c6beb5…` candidate for current source identity. The superseded report remains historical evidence of the earlier missing one-time-finish transition. The current corrected backend still requires renewed independent review and ROOT integration. No installed or physical-preview acceptance is claimed.
