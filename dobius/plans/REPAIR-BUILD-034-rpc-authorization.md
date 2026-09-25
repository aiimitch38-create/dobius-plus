# REPAIR BUILD-034 — RPC authorization (#21 #18) · Upstream

## Bugs
- **#21 (B4)** `ipc/runtime.ts` `runtime:call` handed any IPC sender the full RPC surface with
  a hardcoded placeholder token (`authToken: 'desktop-ipc'`). `RpcDispatcher.dispatch()` never
  checks `authToken` (auth lives only in the socket transport's `parseAndAuth`), so the handler
  was the only possible boundary, and it checked nothing about the sender.
- **#18 (B2)** `runtime-rpc.ts` `MOBILE_RPC_METHOD_ALLOWLIST` includes `terminal.send`,
  `git.push`, `worktree.rm`, `settings.update`. A leaked phone QR token = a shell on the Mac.
  Two aliases of `terminal.send` also existed: binary `Input` frames on `terminal.subscribe` /
  `terminal.multiplex` (both call `runtime.sendTerminal`), and `terminal.create` /
  `session.tabs.createTerminal` with a caller-chosen `command` / `env` / `launchConfig`.

## Root cause
- #21: no sender check at the only boundary the IPC path has.
- #18: the mobile scope was a single yes/no allowlist; there was no notion of "this method is
  mobile-capable but must be explicitly granted per device".

## Fix
- `src/main/ipc/runtime.ts`: `isTrustedRuntimeCallSender(event)` — sender alive, registered in
  `renderer-window-registry` (main + tear-off + floating-phone + self-edit windows; the same
  trust set `pty:write` already uses), and `event.senderFrame` is the top frame
  (`parent === null`). Otherwise returns a `forbidden` RPC error envelope (not a throw, so the
  renderer's `runtime-rpc-client` keeps its normal error path). Webview guests, subframes,
  destroyed or unregistered webContents are denied.
- `src/main/runtime/mobile-rpc-grants.ts` (new): `MOBILE_RPC_GRANTS` = the four spec methods;
  `requiredMobileRpcGrant(method, params)` maps each to itself, and maps terminal creation that
  carries `command`/`env`/`launchConfig` to `terminal.send`; `deviceHasMobileRpcGrant`.
- `src/main/runtime/device-registry.ts`: `DeviceEntry.grants?: MobileRpcGrant[]`; parse keeps
  only known grant strings (unknown/malformed → none; never fails the registry read).
- `src/main/runtime/runtime-rpc.ts` `handleWebSocketMessage`: after the allowlist check, a
  mobile device lacking the required grant gets `forbidden` before dispatch. For mobile devices
  the `registerBinaryStreamHandler` callback is wrapped (`guardMobileTerminalInput`) so `Input`
  frames are dropped unless the device (re-read per frame) holds `terminal.send`; resize,
  subscribe, snapshot frames pass through. Runtime-scoped tokens and the Unix socket are
  unchanged.
- `MOBILE_RPC_METHOD_ALLOWLIST` itself is unchanged: the four methods remain "mobile-capable",
  so `mobile-rpc-allowlist.test.ts` (mobile app ⊂ allowlist) still holds.

## Decision for Carson (implemented default = deny)
A phone token gets every allowlisted method **except** `terminal.send` (including binary
keystrokes and terminal creation with a startup command), `git.push`, `worktree.rm`,
`settings.update`. To grant, add e.g. `"grants": ["terminal.send"]` to that device's entry in
`<userData>/dobius-devices.json` (edit with the app closed). No UI yet. Consequence: typing
into terminals from the phone app is off until granted. The phone listener itself is already
off by default (BUILD-003).

## Deviations from EXECUTION-ORDER.md
- `rpc/dispatcher.ts` not changed: `dispatch()` is transport-agnostic and trusts its caller by
  design; authorization belongs at each transport boundary (socket `parseAndAuth`, WS device
  scope, IPC sender check). Adding a token check there would need a real desktop token the
  renderer would have to hold, which is weaker than a sender check.
- `device-registry.ts` edited (not listed) to carry the per-device grant.
- The desktop IPC path is not method-restricted: the trusted main-frame renderer already has
  `pty:write`, so a method allowlist would add no protection and would break local-runtime
  features that route through `runtime-rpc-client.ts`.

## Tests
- `src/main/ipc/runtime.test.ts`: existing desktop flows (`status.get`, `projectGroup.list`)
  now come from a registered app window's top frame and still pass; new: unregistered
  webContents, subframe, null senderFrame, destroyed webContents → `forbidden`, handler not
  run.
- `src/main/runtime/runtime-rpc-mobile-grants.test.ts` (new): mobile token without grant denied
  the four methods (dispatcher never called); ordinary mobile methods and agent-only
  `session.tabs.createTerminal` still dispatch; create-with-`command`/`env`/`launchConfig`
  denied; per-grant allow; runtime scope unrestricted; binary `Input` dropped for ungranted
  mobile, non-input frames pass, input passes after grant; runtime-scope binary input
  unaffected; registry parse keeps valid grants, drops unknown and malformed.
- `src/main/runtime/runtime-rpc.test.ts`: two existing tests that asserted a phone could
  `git.push` / `settings.update` / `terminal.send` now grant those first (they cover routing).

## Mutation checks (each made the named tests fail, then restored)
- A grant check off in `handleWebSocketMessage` → 3 failed (deny four, create-with-command,
  per-grant allow).
- B binary Input guard bypassed → 1 failed (drops binary Input frames).
- C IPC trust check off → 4 failed (all sender-trust tests).
- D `frame.parent === null` removed → 1 failed (subframe).
- E registry membership check removed → 1 failed (unregistered webContents).
- F grant filter in registry parse removed → 1 failed (ignores unknown grants).
- G terminal-create startup-field check removed → 1 failed (create-with-command).

## Verification
- `pnpm run typecheck` exit 0.
- Targeted: `runtime-rpc-mobile-grants`, `ipc/runtime`, `runtime-rpc`, `mobile-rpc-allowlist`,
  `device-registry`, `remote-runtime-request-connection.integration`, `mobile-listener-setting`,
  `mobile-pairing-userdata-path`, `mobile-subscribe-integration`, `rpc/`,
  `renderer-window-registry`: green. One run of the 63-file batch saw
  `runtime-rpc.test.ts > long-poll transport > emits keepalive frames` fail on timing (Unix
  socket keepalive, untouched code); re-ran `runtime-rpc.test.ts` alone 3× → 50/50 each.
- oxlint (default + react-doctor) clean on all changed files.
- Full suite: DEFERRED (coordinator).

## Rollback
Revert the commit. No data migration: `grants` is an optional field; older builds ignore it.

## Residual risk (not in scope)
Other mobile-allowlisted mutating methods remain ungated: `git.commit`, `git.discard`,
`worktree.forceDeleteBranch`, `worktree.create`, `repo.update`, `files.createFile`,
`files.writeTerminalArtifact`, `github.mergePR`, `gitlab.mergeMR`, `terminal.close`. Some may
be shell-equivalent (e.g. repo hooks / setup scripts via `repo.update`, `worktree.create`).
