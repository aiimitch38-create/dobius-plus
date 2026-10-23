# Application catalog boundary

The desktop and headless runtime share one main-process `ApplicationDataCatalog`
instance and one private registration file under canonical user data. This browse
registry is independent of worker enrollment, the job queue, monitor inventory,
the active tab, and AWS backups. Registration does not move or back up files.

## Authorization and methods

Only an authenticated local caller can choose a folder through the app's native
directory picker, list paired devices, grant or revoke a paired device's browse
access, or remove a registration. Headless serve cannot display a picker. The
RPC methods reject caller filesystem paths and unknown mutation fields.

`data.catalog.roots` and `data.catalog.page` are classified as mobile read methods.
The server derives their principal from the authenticated device UUID; bearer
tokens and request parameters cannot impersonate a local or paired principal.
Each read rechecks the current pairing and explicit per-root grants. Phone root
rosters omit the local sharing configuration and canonical filesystem paths.

The dispatcher receives the catalog through both local IPC and runtime-server
dependency injection. Neither transport creates another registry or infers a
root from the selected workspace. Root replacement and cursor reuse remain
subject to the core scanner's generation, identity and single-consumer checks.

## Owned filesystem bridge

On macOS and Linux the factory chooses an executable Python 3 from fixed absolute
installation locations, then starts the application-owned descriptor helper
lazily. It does not accept an interpreter, script, shell command or arbitrary
arguments from an RPC caller. Development resolves the helper below the app's
`config/scripts/data-catalog`; packaged builds copy only
`descriptor-directory-bridge.py` to `Resources/data-catalog` using the builder's
resource configuration. Test scripts are excluded from that resource entry.

The helper uses isolated Python mode without bytecode writes. Its fixed protocol
returns directory names and stat metadata, never original note/file contents.
The descriptor bridge validates responses and kills only its own child on
timeout or malformed replies. See [descriptor bridge](DATA-CATALOG-DESCRIPTOR-BRIDGE.md).

Missing helpers/interpreters and unsupported Windows descriptor traversal refuse
scans with `race_safety_unavailable`; there is no path-only fallback. Registration
can remain available while scanning is unavailable. Closing the application
first closes catalog sessions, then disposes its owned bridge. New mutations and
late native-picker results are refused after closure. A bounded disposal is not
proof of child exit unless the bridge actually confirms cleanup.

## Verification and delivery

`application-catalog-factory.test.ts` uses disposable real directories to verify
development and staged packaged helper resolution, metadata-only reads, phone
grant/revocation, missing-helper refusal, and picker completion after shutdown.
`runtime/rpc/methods/data-catalog.test.ts` drives the real dispatcher and verifies
authenticated privilege boundaries, unknown path refusal, pairing removal,
cancelled selection and concurrent chooser refusal. Original bytes remain intact.

These are source and fixture checks. A staged resource directory is not an
installed Electron bundle. Full packaging, independent review, installed desktop
behavior and physical phone acceptance have separate delivery gates. The main
application facade now owns a separate opt-in original-text preview service.
It only issues a short-lived reference for an exact metadata row emitted to the
same trusted connection, then rechecks registration, grants, helper incarnation
and file version for each bounded read and visibility lease. Preview settings
default off and remain separate from browse grants. Until trusted IPC/WebSocket
adapters and both clients consume the strict preview schemas, these source
methods are not evidence that preview is exposed to a user. Preview bytes are
not added to the metadata page, job queue, journal, agent context or catalog
persistence. AWS remains deferred and the historical Storage queue remains
paused.

The FIXER implementation is split by service, session, and metadata traversal
responsibility across `catalog-preview-service*.ts`, `catalog-preview-start.ts`,
`catalog-preview-transfer.ts`, `catalog-session-*.ts`, and
`metadata-directory-*.ts`/`metadata-entry-projection.ts`; each TypeScript source
module stays below 300 lines. Authority invalidations are deduplicated by
connection, root, and generation so one connection previewing multiple roots
receives an event for every affected root.
The service requires the descriptor bridge's synchronous `previewHelperEpoch`
capability in addition to `statPreview` and `readPreviewChunk`. Without that
capability, metadata pages remain usable but do not create preview witnesses.
Descriptor operations must close their opened root before the final no-await
authority and offset/lease decision.

Native enrollment now requires the bridge's `captureRootIdentity` capability.
Missing or unsupported proof grants no folder access. The owned helper captures
and checks the native filesystem provider token on opened directory descriptors;
the packaged resources include both `descriptor-directory-bridge.py` and its
focused `native-root-identity.py` module. No RPC accepts executable or filesystem
root arguments. Shutdown aborts pending enrollment before disposing the owned
bridge, preventing a late selection from persisting permission.
