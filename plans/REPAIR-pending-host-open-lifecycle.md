# Repair: invalidate pending host opens on explicit close

## Diagnosis

Iris's actual React-provider harness (message `msg_6ba88b46422d`) reproduced three lifecycle races in the unchanged `client-context.tsx`: `closeHost()` does nothing while `loadHosts()` is pending; a new acquisition after close joins that obsolete promise and can use its old endpoint; and provider cleanup runs while the store is empty, after which the pending open can still connect and populate the store. The same harness confirmed that ordinary navigation release to refcount zero is intentional foreground keepalive behavior and must remain unchanged.

Relevant source: `dobius/mobile/src/transport/client-context.tsx` (`openEntry`, `acquire`, `forceReconnect`, provider cleanup, and `release`); host removal calls close before awaiting storage deletion in `dobius/mobile/app/h/[hostId]/index.tsx` and `dobius/mobile/app/index.tsx`.

## Plan

- Add per-host open generations and a provider lifecycle epoch in `dobius/mobile/src/transport/host-open-lifecycle.ts`. A pending open may continue only while both tokens remain current.
- Explicit close/removal invalidates the current host open even when no client exists, clears its primed profile, and closes any materialized entry.
- Provider cleanup invalidates every late open and closes materialized clients. StrictMode effect cleanup/setup must leave the provider usable while invalidating work from the prior lifecycle.
- A new acquisition after invalidation starts a fresh open rather than waiting on the stale promise. Old completion may not delete or overwrite the new pending entry.
- Preserve zero-ref foreground keepalive and ensure `forceReconnect` deliberately invalidates older pending work while retaining its selected profile.
- Move the existing client connection/token-rotation callback into `dobius/mobile/src/transport/connect-host-profile.ts` to keep the provider file within the repository's existing max-lines lint limit without changing token persistence behavior.

## Regression coverage

Use the real `RpcClientProvider` and hooks with deferred `loadHosts`/mocked `connect` boundaries to cover close-before-load completion, fresh acquisition after close with a changed endpoint, provider unmount before load completion, StrictMode effect replay, and zero-ref release retaining a live client. Include stale completion overlapping a fresh open so old cleanup cannot delete the new pending record. Regression file: `dobius/mobile/src/transport/client-context-pending-open.test.ts`.

Run the focused regression through the supported repository runner where possible, the existing direct Node/React harness if Vitest's known OXC pre-collection failure persists, mobile TypeScript, scoped lint/format, and `git diff --check`.

## Rollback

Revert only the focused lifecycle commit. No storage schema, RPC protocol, native source, dependency, or configuration changes are planned.

## Verification status

Implementation is present. Node 24/esbuild/React Test Renderer harnesses exercised the actual provider and passed close invalidation, fresh-open endpoint selection, provider teardown fencing, StrictMode effect replay, zero-ref foreground keepalive, and stale completion overlapping a newer pending open. Mobile `pnpm exec tsc --noEmit -p tsconfig.json` passed (exit 0); scoped `oxlint` and `oxfmt --check` passed (exit 0). The focused Vitest command exits 1 before collection with the known Vite/OXC `TSCONFIG_ERROR: Tsconfig not found`; zero tests ran. This harness evidence does not claim a Vitest pass or physical-device reproduction.
