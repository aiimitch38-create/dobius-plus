# Adam Telegram draft gateway

This is a Dobius-main-owned transport into the **existing Adam Hermes profile**.
It registers the supported `dobius_adam_telegram` platform and uses one
`GatewayRunner` and its ordinary message dispatcher. It is not an API-server
agent, a second profile, a terminal prompt, or attachment to Adam's open TUI
conversation. Adam's profile configuration, model/provider auth, identity and
memory continue to be loaded by Hermes under the actual `HERMES_HOME`.

The adapter never talks to Telegram. Its only result is a proposed reply. Dobius
owns selected groups, participant consent, drafts, approval and final delivery.

## Start contract

Only Electron main may spawn this runner, using its verified Hermes Python and
source tree and exact Adam profile. Parent must validate these paths and bind
responses to that exact child and its inherited private duplex descriptor 3:

```text
<Hermes-root>/venv/bin/python <app-resources>/adam-telegram/bridge_runner.py \
  --hermes-root <Hermes-root> \
  --profile-home <Hermes-home>/profiles/adam
```

Use an inherited Node `stdio[3] = 'pipe'` duplex channel. There is no socket
listener, HTTP endpoint, bearer file, credential export or PTY. Stdout/stderr
are not protocol channels and should be ignored by the parent. No Telegram
session, API hash, login code, provider key or account credential crosses FD3.

POSIX socketpair descriptors (macOS/Linux, including supported remote hosts)
are supported. Native Windows Node named-pipe handles are rejected explicitly;
they must not fall back to an unauthenticated listener. A Windows transport
adapter requires a separate authenticated inherited-handle implementation.

The runner uses Hermes' existing profile runtime lock and PID file, without
replacement or killing another gateway. A profile already running a gateway
returns `gateway-busy`. The TUI is a separate session owner and remains open.

The runner requires the maintained generic Hermes host tool-policy seam:

- `PlatformEntry.tool_execution_policy='no-tools'`;
- `agent.host_tool_policy.NO_TOOLS_POLICY`, `require_platform_tool_policy()`
  and `policy_for_platform()`;
- immutable `AIAgent.host_tool_policy` and actual executor enforcement;
- `GatewayRunner(config, *, session_db=..., perform_maintenance=False)` and
  `SessionStore(..., session_db=...)` injection.

Missing/inconsistent policy fails before `ready`. No YAML empty toolset list or
prompt is accepted as a substitute for the host policy. Opaque native-tool
provider modes must be rejected by that policy. Gateway proxy routing is
disabled because a remote API runner cannot attest the local policy.

`hermes-core-policy-manifest.json` pins every reviewed enforcement site and the
maintained `hermes-core-policy.patch`, plus the exact reviewed Git HEAD. Their exact bytes are verified before any
Hermes imports, before startup and every request admission and delayed model
dispatch. Partial/upstream updates fail closed even when the policy helper
module survives. Cancellation remains available during source drift. Updating
Hermes requires reapplying/reviewing the maintained patch and publishing a new
verified manifest; helper presence alone never grants readiness.

## Scoped lifecycle and persistence

The runner constructs one `GatewayRunner` with a private injected SessionDB and
binds its registered adapter to the normal `_handle_message` dispatcher. It
does **not** call the global `GatewayRunner.start()` / `stop()` lifecycle, which
would resume unrelated sessions, start cron/kanban/handoff watchers, execute
global maintenance or clean up unrelated tools. The scoped runner does not
enable any other platform, discover startup hooks, or change profile config.

Bridge session state and transcripts live under
`<Adam-profile>/dobius-telegram-bridge/`; the TUI's existing default state.db is
not opened or maintained by this gateway. The inherited profile home remains
Adam's real profile, so this storage boundary does not create a new identity.

The private directory is mode `0700`; durable receipt SQLite is `0600` with
FULL synchronous commits. Symlink, hard-link, wrong-owner and broadly readable
receipt paths fail closed. Request text is not retained in the receipt table;
it stores request ID, canonical payload SHA-256 and terminal response. Normal
Hermes isolated conversation transcripts retain the accepted user messages.

Each `(groupId, senderId)` is a separate gateway session and serial inference
lane. Distinct senders never share the gateway conversation. No thread IDs are
invented and no group history is scraped. Slash-leading message text is quoted
inside a normal text event, never passed to the gateway command router. Events
have `internal=False`; intake authorization comes from the private pipe, with
Dobius performing live selected-group and participant-consent checks first.

At most 32 requests are outstanding; at most **two** distinct lanes infer
concurrently. Ordinary bursts wait in the bounded queue. Overflow receives a
durable `gateway-busy` terminal receipt for manual review, without automatic
retry. Parent owns the overall request timeout and must cancel expired queued
requests explicitly. Queue wait consumes that overall timeout; this child does
not silently extend it or retry uncertain requests.

## Wire protocol v1

Frames are UTF-8 newline-delimited JSON, at most 128 KiB each. Duplicate JSON
keys, unknown fields/types, non-decimal identities, malformed Unicode and
oversized data terminate the protocol with a closed error. Empty text and
text longer than 16,000 characters are refused. Group titles are at most 256
characters and never confer authority.

Parent sends a fresh 32-byte base64url nonce (43 characters, no padding):

```json
{"v":1,"type":"hello","nonce":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
```

After profile ownership, registration and effective policy verification:

```json
{"v":1,"type":"ready","nonce":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","profile":"adam","platform":"dobius_adam_telegram","policy":"no-tools"}
```

Parent can now send:

```json
{"v":1,"type":"request","id":"tg_stable_source_digest","groupId":"-100123","senderId":"345","messageId":"7","groupTitle":"Client group","text":"Please draft a reply"}
```

Successful final draft:

```json
{"v":1,"type":"reply","id":"tg_stable_source_digest","text":"Proposed reply awaiting approval"}
```

Every admission is committed **before** entering inference. An identical pending
duplicate observes the original terminal response and never starts another
turn. An identical completed duplicate replays the durable response. Reusing an
ID with a different canonical payload returns `request-conflict`. Admission
left pending by a process crash becomes `request-interrupted` on next startup;
it is never silently inferred a second time. This favors explicit recovery over
duplicate model calls or misleading claims of exactly-once execution.

Cancel is exact to the request and its currently leased lane:

```json
{"v":1,"type":"cancel","id":"tg_stable_source_digest"}
{"v":1,"type":"error","id":"tg_stable_source_digest","code":"cancelled"}
```

The terminal cancellation receipt is committed before acknowledgment. Late
output is fenced. The lane stays leased until its actual inference coroutine
settles, so a following turn cannot inherit the cancelled running agent. A
cancel arriving after terminal completion replays that terminal result; parent
must still fence cancelled/expired requests before showing or approving drafts.

On pipe close, all active turns receive durable cancellation and exact agent
interrupts. The runner allows five seconds for provider completion. If a
provider ignores interruption, the process exits without waiting indefinitely
for Python's default executor; the OS releases its runtime lease at process
exit. Parent also owns bounded child termination. A later child cannot replay
an uncertain inference as new work.

Errors expose only these codes, never raw SDK/provider exception strings:
`protocol-error`, `request-conflict`, `request-interrupted`, `cancelled`,
`inference-failed`, `gateway-busy`, `policy-unavailable`, `profile-unavailable`,
`gateway-unavailable`, `output-unavailable`, `receipt-unavailable`,
`request-not-found`. Startup/protocol errors use an empty ID; request errors echo
their exact ID. `cancelled` acknowledges output fencing, not proof that an
in-flight provider HTTP request was remotely revoked.

## Deterministic tests

```sh
python3 -m unittest discover -s dobius/resources/adam-telegram -p 'test_*.py' -v
```

The suite uses synthetic gateways/providers, temporary state and local
socketpairs. It covers split/coalesced/oversized/malformed frames, nonce
handshake, private file validation, repeated/conflicting admission, crash and
completed replay, cancel-before-dispatch, cancel-vs-late-output, independent and
serial session lanes, policy readiness/failure, exact interrupt targeting,
isolated database/config and a draft-only adapter. It performs no live provider
call, profile read, account lookup or Telegram operation. A production
readiness handshake and an authorized end-to-end test remain separate live
acceptance; passing synthetic tests alone does not claim Adam is connected.
