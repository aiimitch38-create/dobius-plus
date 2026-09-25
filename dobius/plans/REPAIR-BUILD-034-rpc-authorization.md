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
| `terminal.send` | terminal.send, binary Input frames, terminal.close, session.tabs.close, worktree.sleep; terminal.create / session.tabs.createTerminal with command/env/launchConfig/agent/launchAgent/launchToken; worktree.activate without `notifyClients:false` (desktop activation resumes sleeping agents); worktree.create with startupCommand/Env/LaunchConfig/Agent/Prompt/Draft, `setupDecision:'run'`, `runHooks:true` |
| `worktree.create` | worktree.create (any) |
| `worktree.rm` | worktree.rm, worktree.forceDeleteBranch |
| `git.push` | git.push, git.forkSync (pushes to origin) |
| `git.discard` | git.discard, git.abortMerge, git.abortRebase |
| `git.sync` | git.checkout, git.pull, git.fastForward, git.rebaseFromBase; worktree.create with baseBranch/pushTarget (imports another ref's files and runs its checkout hooks) |
| `settings.update` | settings.update, linear.connect, linear.selectWorkspace |
| `files.write` | files.writeTerminalArtifact, files.createFile, markdown.saveTab (host-side path guard refuses protected files and Dobius data even with the grant) |
| `remote.merge` | github.mergePR, github.setPRAutoMerge, github.updatePRState, github.project.updatePullRequestBySlug, gitlab.mergeMR, gitlab.updateMRState |
| `remote.write` | every outward tracker write: hostedReview.create; github createIssue, addIssueComment, addPRReviewComment(Reply), request/removePRReviewers, rerunPRChecks, resolveReviewThread, setPRFileViewed, updateIssue, updatePR, updatePRTitle, all github.project.* writes; gitlab createIssue, addIssueComment, addMRComment, resolveMRDiscussion, updateIssue, updateMR; linear createIssue, createProject, addIssueComment, updateIssue |
| `browser.control` | every mobile browser.* method except browser.screencast.unsubscribe (navigate, click, type, keys, dialogs, reload, viewport, tabCreate, screencast) |

Rejected for mobile outright (no grant unlocks it): AI generation overrides
(`commitMessageAi`, `sourceControlAi`, `sourceControlAiResolvedParams`, `agentCmdOverrides` on
git.generateCommitMessage / generatePullRequestFields / discoverCommitMessageModels) and
repo.update of `hookSettings`, `sourceControlAi`, `worktreeBasePath`, `symlinkPaths`, `forkSyncMode`,
`upstream`; any method not classified in `mobile-rpc-method-classes.ts` (default deny);
worktree.set of `pushTarget` / `parentWorktree` / `baseRef`; ui.set of `trustedDobiusHooks`,
`setupScriptPromptDismissedRepoIds`, `browserDefaultUrl`, `browserKagiSessionLink`, `customPets`,
`customSidekicks`, `dismissedUpdateVersion`, `dismissedUpdateNudgeId`, `pendingUpdateNudgeId`; browser.goto / browser.tabCreate with any URL that is
not http(s) (file:, bare paths, javascript:, leading `-`); files.createFile / writeTerminalArtifact /
markdown.saveTab to ANY dot-file or anything under ANY dot-directory (.git, .claude, .codex, .github,
.clinerules, .kiro, .continue, .windsurf, .opencode, .factory, .roo, .amazonq, .husky, .vscode,
.envrc, .mcp.json, .goosehints, ...), or a file named CLAUDE.md, CLAUDE.local.md, AGENTS.md,
AGENTS.override.md, GEMINI.md, CRUSH.md, QWEN.md, CONVENTIONS.md, dobius.yaml or package.json
anywhere (names APFS-folded, checked relative to the worktree), into
the userData root or ~/.dobius, through a symlink, or (createFile/saveTab) outside the worktree.
Removed from the mobile allowlist: `agentTeams.prepareLaunch`, `agentTeams.tmuxCompat` (no mobile
caller; tmux `send-keys` types into shells).

To grant: add e.g. `"grants": ["terminal.send", "worktree.create"]` to that device's entry in
`<userData>/dobius-devices.json` **with the app closed** (grants are read at startup; a running
app's next save would overwrite a live edit). No UI yet. Consequences with defaults: from the
phone, no terminal typing/closing, no worktree create/sleep/remove, no discard, push, fork sync,
merge, settings or Linear change, no tracker writes (issues, PR/MR comments, reviewers, PR
creation), no file writes, and no in-app browser control or screencast. The phone listener itself is off by default (BUILD-003).

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

## Review round 3 (re-review: 1 HIGH, 3 MEDIUM, 2 LOW)
Merged `stabilize/integration` first (clean merge, 78ce8616).
- F1 HIGH: new `browser.control` grant over all driving/watching browser.* methods. Independently
  of grants, mobile browser.goto/tabCreate accept only http(s) (after `normalizeBrowserNavigationUrl`,
  so bare hosts like `example.com` and `localhost:3000` still work; file:, bare absolute paths,
  javascript: and leading `-` are rejected). `AgentBrowserBridge.goto` now rejects a URL starting
  with `-` for every caller (argv flag injection). **Not changed:** `will-attach-webview` /
  `createBrowserTab`. They only see the webview `src`; an RPC-created tab and the desktop's own
  "Open Preview to the Side" `file:` preview mount through the same renderer path, so telling them
  apart would mean threading an origin flag through the renderer tab model. Runtime-scoped CLI
  tokens also legitimately open local previews. Gating is at the mobile RPC boundary only.
- F2 MEDIUM: markdown.saveTab and files.createFile under `files.write`; protected paths refused
  even with the grant (files.createFile / writeTerminalArtifact at the transport from params;
  markdown.saveTab in its handler, which reads the tab's host-side path when `clientKind` is
  mobile, since the save params carry no path).
- F3 MEDIUM: worktree.set rejects `pushTarget` / `parentWorktree` for mobile.
- F4 MEDIUM: linear.connect / linear.selectWorkspace under `settings.update`.
- Low: git.forkSync under `git.push`; sweep-table wording corrected.

Mutation checks round 3 (failing tests): screencast grant 1, http(s) scheme check 5, leading `-`
at RPC 2, saveTab grant 1, createFile grant 1, protected paths at RPC 8, saveTab handler path
check 5, worktree.set fields 2, linear.connect 1, forkSync 1, bridge leading `-` 1.

## Review round 4 (final: 3 MEDIUM, 2 LOW, unverified risks)
Merged `stabilize/integration` first (clean, ca522cdd).
- Design: default deny. `mobile-rpc-method-classes.ts` classifies every allowlisted method as
  `read`, `benign-mutation` or a grant; `mobileRpcRequirement` rejects any method with no
  classification, and a test fails if an allowlisted method is unclassified or a class entry is
  stale. `MOBILE_RPC_METHOD_ALLOWLIST` is now exported for that test.
- F1 github.project.updatePullRequestBySlug → remote.merge. F3 new `remote.write` grant (list in
  the Decisions table). F4 repo.update rejects forkSyncMode / upstream. F5 abortMerge /
  abortRebase → git.discard.
- F2 + unverified risks: new host-side guard `mobile-write-path-guard.ts`, run by the
  files.createFile, files.writeTerminalArtifact and markdown.saveTab handlers when
  `clientKind === 'mobile'`. It folds names like APFS (NFKC, ſ→s, Kelvin K→k, lowercase),
  realpaths the deepest existing ancestor, refuses a symlinked target, refuses when the name
  resolves to a differently spelled on-disk entry, refuses when a symlinked ancestor redirects
  the write, refuses anything in the userData root (`getUserDataRoot()`) or ~/.dobius (including
  via symlink), and checks the protected list on the path RELATIVE to the real worktree root, so
  worktrees under `<repo>/.claude/worktrees/` save normally. Outside the worktree:
  createFile/saveTab refuse; writeTerminalArtifact checks the full path (so ~/.claude/** is
  refused; fail-closed for files in other worktrees under .claude/worktrees). SSH worktrees get
  the folded lexical checks only (host cannot inspect the remote filesystem).
- `DobiusRuntimeService.resolveMobileWriteRoot(worktree)` exposes the worktree root and
  connectionId for the guard.
- The transport keeps an early folded check on files.createFile's relative path only; the
  absolute-path transport check was removed (it caused the .claude/worktrees false positive).

Mutation checks round 4 (failing tests): default deny off 1, classification entry removed 2,
updatePullRequestBySlug→benign 1, hostedReview.create→benign 1, forkSyncMode reject 1,
abortMerge→benign 1, APFS fold → plain lowercase 5, package.json 2, .husky 1, .vscode/tasks.json 1,
file-symlink refusal 1, symlinked-ancestor refusal 2, data-root check off 2, data-root check
lexical-only (symlink) 1, protected check on absolute instead of relative path 2 (the
.claude/worktrees false positive), ~/.dobius root 1, writeTerminalArtifact handler wiring 2.

## Review round 5 (final: 2 MEDIUM, 2 LOW + unverified item)
Merged `stabilize/integration` first (clean, 621f5937).
- F1: new `git.sync` grant (checkout, pull, fastForward, rebaseFromBase); worktree.set rejects
  `baseRef`; also worktree.create with `baseBranch`/`pushTarget` needs `git.sync` (same import
  path; beyond the finding). git.fetch stays ungated.
- F2: ui.set rejects hook-trust / setup-prompt dismissal. Scanned the whole `UiUpdate` schema
  (client-ui.ts) and also rejected browserDefaultUrl, browserKagiSessionLink, customPets,
  customSidekicks (unvalidated records rendered in the privileged renderer) and the three update
  dismissal fields. The rest is view/layout state. Note: the phone's own "approve setup hook" flow
  (NewWorktreeModal / tasks.tsx) wrote trustedDobiusHooks and now gets `forbidden`.
- F3: `agent`, `launchAgent`, `launchToken` added to the terminal startup fields.
- F4: chose the class rule: every dot-file and dot-directory segment is refused, plus named agent
  files (added CRUSH.md, QWEN.md, CONVENTIONS.md). Applies to all guarded writes.
- Unverified item: worktree.activate without `notifyClients:false` triggers the renderer
  activation flow, which calls `resumeSleepingAgentSessionsForWorktree`
  (src/renderer/src/lib/worktree-activation.ts) → now needs `terminal.send`. isArchived: no hook
  path (see sweep).
- Integration note: after the merge, `src/main/runtime/dobius-runtime.test.ts` has 2 failures
  ("pre-marks remote Codex workspaces trusted before pasting startup drafts / explicit startup
  commands"). They passed before the merge, this round does not touch dobius-runtime.ts, and the
  merge brought `remote-agent-trust-presets.ts` changes from BUILD-009C (a00389d5). Reported, not
  fixed here.

Mutation checks round 5 (failing tests): checkout→benign 1, pull→benign 1, baseRef reject 1,
worktree.create sync fields 2, trustedDobiusHooks reject 1, browserDefaultUrl reject 1, agent
fields 3, dot-segment rule off 24, CRUSH.md 1, activation resume gate 1.

## Mobile allowlist sweep (231 methods)
The table of record is `src/main/runtime/mobile-rpc-method-classes.ts` (one line per method,
enforced by test). Summary:

| Class | Methods |
|---|---|
| grant `terminal.send` | terminal.send, terminal.close, session.tabs.close, worktree.sleep (+ startup fields on terminal.create, session.tabs.createTerminal, worktree.create; binary Input frames) |
| grant `worktree.create` / `worktree.rm` | worktree.create / worktree.rm, worktree.forceDeleteBranch |
| grant `git.push` / `git.discard` | git.push, git.forkSync / git.discard, git.abortMerge, git.abortRebase |
| grant `git.sync` | git.checkout, git.pull, git.fastForward, git.rebaseFromBase |
| grant `settings.update` | settings.update, linear.connect, linear.selectWorkspace |
| grant `files.write` | files.createFile, files.writeTerminalArtifact, markdown.saveTab |
| grant `remote.merge` / `remote.write` | see Decisions table |
| grant `browser.control` | all browser.* except screencast.unsubscribe |
| read | status/settings/ui get, host.*, stats, diagnostics, every list/read/diff/history/status, subscriptions and unsubscribes, terminal read/list/wait/multiplex/subscribe, files read/list/resolveTerminalPath, tracker reads, preflight detect, repo reads, nativeChat, notifications, clientEvents, voice.reply |

benign-mutation (ungated), one-line reasons:
- git.stage / unstage / bulkStage / bulkUnstage: index only, reversible.
- git.commit: local commit, reversible; runs only repo-owned hooks (a phone can no longer write .husky/.git).
- git.fetch: only reads from the configured remotes into remote-tracking refs; changes no working files.
- git.generateCommitMessage / generatePullRequestFields / discoverCommitMessageModels: use stored AI settings only (overrides rejected); a paid model run, but no new command.
- git.cancelGenerate*: cancel.
- terminal.create / session.tabs.createTerminal without startup or agent fields: idle shell; input stays gated.
- terminal.clearBuffer / focus / rename / setAutoRestoreFit / setDisplayMode / updateViewport, session.tabs.activate / move: display state only.
- worktree.activate with `notifyClients:false` (what the phone sends): mobile-only session hydration, no desktop activation; I did not trace `hydrateHeadlessMobileSessionTabsFromWorkspaceSession` to prove it never spawns a PTY.
- worktree.set `isArchived`: metadata only. Archive hooks run only in removeManagedWorktree (worktree.rm, already gated; dobius-runtime.ts removeManagedWorktree `hooks?.scripts.archive && runHooks`); no renderer code acts on isArchived to run hooks or kill terminals (grep).
- worktree.set (without pushTarget/parentWorktree), repo.update (without rejected fields), repo.saveSparsePreset, worktree.prefetchCreateBase: metadata / fetch only.
- files.open / openDiff: opens a desktop tab.
- clipboard.*: writes an uploaded image to a temp file.
- accounts.selectClaude / selectCodex: switches between accounts already signed in on the Mac.
- ssh.connect: connects an already-registered target only.
- speech.dictation.*, speech.models.download / delete: dictation state; catalog models by id (inferred from the handler, not traced further).
- preflight.check: re-runs fixed local tool detection.
- ui.set (security-relevant fields rejected), ui.recordFeatureInteraction: UI state.
- voice.intent: voice conductor, unchanged by design (C2/C3).

## Residual risk (not in scope)
See the sweep: every remaining ungated mutating method is listed with a reason. The biggest
remaining surface is `voice.intent` (by design, C2/C3). With `browser.control` granted, a phone sees
whatever the desktop browser pane shows, including a desktop-opened `file:` preview it navigates back
to (browser.back/forward/reload stay within that tab's history); that is part of what the grant means.
