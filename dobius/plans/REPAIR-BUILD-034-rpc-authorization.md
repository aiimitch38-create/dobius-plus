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
  (round 1; replaced by `mobileRpcRequirement`, see Review round 2) mapped each to itself, and maps terminal creation that
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

## Decision for Carson (implemented default = deny for every category)
Grant categories (`MOBILE_RPC_GRANTS` in `mobile-rpc-grants.ts`), all **denied** by default:

| Grant | Covers |
|---|---|
| `terminal.send` | terminal.send, binary Input frames, terminal.close, session.tabs.close, worktree.sleep; terminal.create / session.tabs.createTerminal with command/env/launchConfig; worktree.create with startupCommand/Env/LaunchConfig/Agent/Prompt/Draft, `setupDecision:'run'`, `runHooks:true` |
| `worktree.create` | worktree.create (any) |
| `worktree.rm` | worktree.rm, worktree.forceDeleteBranch |
| `git.push` | git.push |
| `git.discard` | git.discard |
| `settings.update` | settings.update |
| `files.write` | files.writeTerminalArtifact |
| `remote.merge` | github.mergePR, github.setPRAutoMerge, github.updatePRState, gitlab.mergeMR, gitlab.updateMRState |

Rejected for mobile outright (no grant unlocks it): AI generation overrides
(`commitMessageAi`, `sourceControlAi`, `sourceControlAiResolvedParams`, `agentCmdOverrides` on
git.generateCommitMessage / generatePullRequestFields / discoverCommitMessageModels) and
repo.update of `hookSettings`, `sourceControlAi`, `worktreeBasePath`, `symlinkPaths`.
Removed from the mobile allowlist: `agentTeams.prepareLaunch`, `agentTeams.tmuxCompat` (no mobile
caller; tmux `send-keys` types into shells).

To grant: add e.g. `"grants": ["terminal.send", "worktree.create"]` to that device's entry in
`<userData>/dobius-devices.json` **with the app closed** (grants are read at startup; a running
app's next save would overwrite a live edit). No UI yet. Consequences with defaults: from the
phone, no terminal typing/closing, no worktree create/sleep/remove, no discard, push, merge or
settings change. The phone listener itself is off by default (BUILD-003).

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

## Review round 2 (coordinator security review, 4 HIGH / 4 MEDIUM / 1 LOW)
Switched from per-field enumeration to grant categories + outright rejects
(`mobileRpcRequirement(method, params)` → `{grants}` | `{rejected}`; runtime-rpc.ts
`mobileRpcDenial`). F1 worktree.create (create grant + terminal.send for spawn fields),
F2 agentTeams removed, F3 AI override fields rejected, F4 repo.update fields rejected,
F5 git.discard, F6 remote.merge, F7 forceDeleteBranch→worktree.rm, F8 terminal.close→terminal.send
(chosen over a separate grant: closing kills a running agent, same trust as typing into it).
F9: comment corrected — the per-frame lookup hits the in-memory registry (in-app revoke is
immediate); grants are read from disk only at startup.
Sweep additions beyond the findings: files.writeTerminalArtifact → `files.write`;
session.tabs.close and worktree.sleep → `terminal.send` (both kill PTYs).

Mutation checks round 2 (each failed the named tests, then restored): create-method grant (1),
worktree startup fields (5), runHooks (1), setupDecision run (1), agentTeams re-added to
allowlist (1), AI override reject (4), repo.update reject (4), git.discard (1),
setPRAutoMerge (1), forceDeleteBranch (1), terminal.close (1), files.writeTerminalArtifact (1),
session.tabs.close (1), worktree.sleep (1).

## Mobile allowlist sweep (231 methods after removing agentTeams.*)
R = read-only / subscription / cancel, G = gated (grant or reject), U = ungated mutating (reason).

| Method(s) | Class | Note |
|---|---|---|
| terminal.send, terminal.close | G | terminal.send |
| terminal.create | G/U | G with command/env/launchConfig; else U: opens an idle shell, input still gated |
| terminal.multiplex, terminal.subscribe | R | stream; binary Input gated by terminal.send |
| terminal.read, list, agentStatus, isRunningAgent, getAutoRestoreFit, wait, unsubscribe | R | |
| terminal.clearBuffer, focus, rename, setAutoRestoreFit, setDisplayMode, updateViewport | U | display state only |
| session.tabs.close | G | terminal.send |
| session.tabs.createTerminal | G/U | G with command/env/launchConfig; else U: agent-only launch picks a configured agent, no caller command |
| session.tabs.activate, move | U | tab layout only |
| session.tabs.list/listAll/subscribe/subscribeAll/unsubscribe/unsubscribeAll | R | |
| worktree.create | G | worktree.create (+ terminal.send for spawn fields) |
| worktree.rm, worktree.forceDeleteBranch | G | worktree.rm |
| worktree.sleep | G | terminal.send |
| worktree.activate, worktree.set | U | selection / metadata (names, links, pin, sparse dirs) |
| worktree.prefetchCreateBase | U | git fetch of a base ref, no local change to work |
| worktree.ps, show, resolveMrBase, resolvePrBase | R | |
| git.push | G | git.push |
| git.discard | G | git.discard |
| git.generateCommitMessage, generatePullRequestFields, discoverCommitMessageModels | G | override fields rejected; stored settings only |
| git.commit | U | local and reversible; runs only repo-owned hooks |
| git.stage, unstage, bulkStage, bulkUnstage | U | index only, reversible |
| git.checkout, fetch, pull, fastForward, rebaseFromBase, forkSync, abortMerge, abortRebase | U | normal git sync; git refuses to clobber dirty work; nothing leaves the Mac |
| git.cancelGenerate* | R | cancel |
| git.status, diff, history, localBranches, upstreamStatus, branchCompare, branchDiff, commitCompare, commitDiff | R | |
| github.mergePR, setPRAutoMerge, updatePRState; gitlab.mergeMR, updateMRState | G | remote.merge |
| github.createIssue, addIssueComment, addPRReviewComment(Reply), requestPRReviewers, removePRReviewers, rerunPRChecks, resolveReviewThread, setPRFileViewed, updateIssue, updatePR, updatePRTitle, project.* updates/comments/clearItemField | U | tracker text/metadata; visible, attributable, reversible; no code runs locally |
| gitlab.createIssue, addIssueComment, addMRComment, resolveMRDiscussion, updateIssue, updateMR | U | same as GitHub tracker edits |
| github/gitlab list/read methods (countWorkItems, listLabels, listWorkItems, prChecks, prCheckDetails, prFileContents, prForBranch, repoSlug, workItem, workItemDetails, project list/view/resolve, todos) | R | |
| hostedReview.create | U | opens a PR/MR from an existing remote branch (no push; checked `createHostedReview`) |
| hostedReview.forBranch, getCreationEligibility | R | |
| linear.addIssueComment, createIssue, createProject, updateIssue | U | tracker edits, same reason as GitHub |
| linear.connect, selectWorkspace | U | swaps Linear account/workspace; no local code |
| linear read methods | R | |
| repo.update | G/U | hookSettings/sourceControlAi/worktreeBasePath/symlinkPaths rejected; rest U: display and discovery prefs |
| repo.saveSparsePreset | U | preset metadata |
| repo.list, baseRefDefault, gitAvailable, hooks, searchRefs, sparsePresets | R | |
| files.writeTerminalArtifact | G | files.write |
| files.createFile | U | creates an empty file in the worktree |
| files.open, files.openDiff | U | opens a tab on desktop |
| files.read*, list, browseServerDir, resolveTerminalPath | R | resolveTerminalPath issues a read/write grant id; the write is gated |
| markdown.saveTab | U | saves a markdown tab already open on desktop (renderer-owned); not verified to be .md-only |
| markdown.readTab | R | |
| settings.update | G | settings.update |
| settings.get, ui.get, status.get, stats.summary, diagnostics.memory, host.*, preflight.detectAgents/detectRemoteAgents | R | |
| ui.set, ui.recordFeatureInteraction | U | UI state only |
| preflight.check | U | re-runs fixed local tool detection; no caller input |
| accounts.selectClaude, selectCodex | U | switches between accounts already signed in on the Mac |
| accounts.list/subscribe/unsubscribe, notifications.*, runtime.clientEvents.*, nativeChat.* | R | |
| browser.* (goto, click, keys, tabCreate, dialogs, reload, viewport, screencast) | U | drives the in-app browser pane, which is sandboxed from the shell; it does carry desktop logins, so this is the largest remaining non-shell risk |
| clipboard.* image upload / saveImageAsTempFile | U | writes an image to a temp file |
| speech.dictation.*, speech.models.list | R/U | dictation session state |
| speech.models.download, speech.models.delete | U | catalog model by id (inferred from handler, not traced further) |
| ssh.connect | U | connects an already-registered SSH target only |
| ssh.getState | R | |
| voice.intent, voice.reply | U | voice conductor; by design (C2/C3), not changed here |

## Residual risk (not in scope)
See the sweep table: the remaining ungated mutating methods are listed with reasons. The biggest
remaining non-shell surface is the in-app browser (`browser.*`) and `voice.intent` (by design).
