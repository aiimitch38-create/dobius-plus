# REPAIR BUILD-SBX — Agent SDK sandbox for Claude agent runs

Follow-up build (not in EXECUTION-ORDER.md). Root fix for Codex review finding F6 (w1-2) and the
BUILD-033 conductor finding: the text rails (`agents/agent-hard-rails*.ts`, CX12) read a command
string, so they cannot stop shell globs over the agents folder, whole-home walkers
(`find ~ | xargs cat`), interpreter file APIs (python `open()`), or attacks split across several calls.

Files: new `dobius/src/main/agents/agent-sandbox-policy.ts`, `agent-runner.ts` (+4 lines).
Tests: new `agent-sandbox-policy.test.ts`, new `agent-runner-sandbox.test.ts`; one `vi.mock` added to
each of the five existing `agent-runner-*.test.ts` files.

## What the SDK offers (read from the installed code, not guessed)

- `@anthropic-ai/claude-agent-sdk` 0.3.201, `sdk.d.ts` `Options.sandbox: SandboxSettings`
  (`enabled`, `failIfUnavailable`, `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands`,
  `filesystem.{denyRead,allowRead,allowWrite,denyWrite}`, `network.{allowedDomains,
  allowAllUnixSockets,allowLocalBinding,...}`, `credentials`). `sdk.mjs` passes it to the CLI as
  `--settings '{"sandbox":...}'` (flag settings) and defaults `failIfUnavailable` to true when
  `enabled` is true.
- Runs spawn the user's installed CLI (`resolveClaudeCommand()`), here Claude Code 2.1.282. Reading
  that binary's embedded sandbox code shows:
  - The sandbox wraps **Bash only** (Seatbelt on macOS, bubblewrap on Linux). Read/Grep/Glob/Write/Edit
    run in-process and are governed by permission rules; `Read(...)`/`Edit(...)` deny rules are also
    merged into the sandbox deny lists.
  - Default write confinement = cwd + a few fixed paths (`/tmp/claude`, `~/.npm/_logs`, ...), so
    `allowWrite` must be widened or npm/pnpm caches and sibling worktrees break.
  - Network is always confined when the sandbox is on: all egress goes through a local proxy
    (`HTTP(S)_PROXY`/`ALL_PROXY` are set). `allowedDomains: ['*']` matches every host.
    Unmatched hosts would otherwise prompt, which headless runs deny.
  - `autoAllowBashIfSandboxed` defaults to true (it would auto-approve Bash), and
    `allowUnsandboxedCommands` defaults to true (the `dangerouslyDisableSandbox` escape hatch).
  - Built-in "mandatory" write protections always apply: `.git/hooks`, `.git/config`, shell rc files,
    `.mcp.json`, `.claude/settings*.json`, `.claude/commands`, `.claude/agents` in the project.
    `allowGitConfig` exists in the runtime but the CLI does not map it from settings.
  - `sandbox.filesystem.allowRead` from EVERY settings source (user, project, local) is merged in and
    re-opens denied regions. `sandbox.enabled: false` in project/local settings does not override the
    flag setting.

## Enforcement verified without any Claude API call

`stabilize-run/SBX/probe/`: a local stand-in for the Messages API (`mock.mjs`, 127.0.0.1) replays
scripted tool calls to the real installed CLI (`ANTHROPIC_BASE_URL` = localhost, fake key, temp HOME
with fake fixtures). No real Claude call and no external network. Results (`final-*.txt`: the exact
policy this module generates, in both `default` and `bypassPermissions` modes; identical):

- Denied: `cat` other agent's MEMORY.md, `cat ~/.dob*/agents/*/MEMORY.md`, `find ~ | xargs cat`,
  python `open()`, `grep -r ~`, symlink / hard-link / cp / mv / rm of another agent's folder,
  upper-case path spelling, `~/.claude/.credentials.json`, `~/.dobius/*.enc`, `*token*`,
  `linear-tokens/*.enc`, `~/Library/Messages`, userData `claude-accounts`/`codex-accounts`, writes to
  other agent / `_crew` folders, `~/.local/bin/dobius-*`, `/Applications`, `~/.claude/settings.json`.
  `dangerouslyDisableSandbox: true` does not escape in bypass mode. Read/Grep/Glob/Write are denied by
  the rules on the same paths (Grep over the whole home returns nothing from them).
- Still works: own agent folder read/write (Bash and Read/Write tools), commit + push to a remote,
  `git worktree add` + commit + push from the worktree, `~/.npm` / `~/Library/Caches` / `$TMPDIR` /
  `/tmp` writes, localhost HTTP (NO_PROXY), unix-socket listen + connect, binding a localhost port,
  `dobius-runtime.json` read (the conductor's `dobius` CLI needs it), Write in the project.
- Escalation found and closed: before the settings-file rules, a Write-tool edit of
  `.claude/settings.local.json` adding `sandbox.filesystem.allowRead` re-opened the agents folder on
  the next command (`out-esc2.txt`). Settings files are now write-denied (Edit rules + denyWrite).

## Fix

`agent-sandbox-policy.ts`:
- `buildAgentRunSandboxPolicy(context)` (pure) returns `{ sandbox, disallowedTools }`:
  - `enabled`, `failIfUnavailable: true` (fail closed), `autoAllowBashIfSandboxed: false` (permission
    flow unchanged), `allowUnsandboxedCommands: false` (no escape hatch).
  - `denyRead`: `~/.dobius/agents` (whole folder, so agents created mid-run are covered),
    `<home>/.claude/.credentials*` and the account config dir's `.credentials*`, `~/.dobius/*.enc`,
    `~/.dobius/**/*.enc`, `~/.dobius/*token*` (+ `/**`), `~/Library/Messages`, userData
    `claude-accounts`, `claude-runtime-auth`, `codex-accounts`, `codex-runtime-home`, `daemon` (pty
    daemon token), `Partitions`, `Cookies`, `Network`, `cookie-import-staging`.
  - `allowRead`: only the run's own `~/.dobius/agents/<id>`.
  - `allowWrite`: home + temp dirs. `denyWrite`: every other entry of `~/.dobius/agents` (incl. `_crew`),
    `~/.local/bin/dobius-*`, `/Applications`, `~/.claude/settings{,.local}.json`, `~/.claude.json`,
    the same files in the account config dir, and the secret dirs above.
  - `network`: `allowedDomains: ['*']`, `allowAllUnixSockets`, `allowLocalBinding`.
  - `disallowedTools`: `Read(//...)`/`Edit(//...)` rules for the same paths (per other agent, since a
    rule cannot carve out the own folder), plus `Edit(**/.claude/settings{,.local}.json)`.
- `resolveAgentRunSandboxPolicy(agentId, configDir)` gathers home, userData root
  (`getUserDataRoot()`), and the agents folder listing. Missing folder = no others; any other listing
  error throws (the run is rejected, never started unconfined).

`agent-runner.ts`: after the hard-rail hooks, `Object.assign(options,
resolveAgentRunSandboxPolicy(agent.id, preparation.configDir))`. Before `addRun`, so a policy failure
rejects the run cleanly. Codex runs are untouched (manual-only since BUILD-022). Rails unchanged.

## Tests

- `agent-sandbox-policy.test.ts` (13): escape hatches closed; own folder re-opened only; other agents +
  `_crew` denied read/write (sandbox + rules); own id never listed as other; credentials in home and
  account config dir; Messages/token/userData secrets denied and `dobius-runtime.json` still readable;
  repo, sibling worktree, npm/pnpm caches, own folder and /tmp writable and not denied; launchers,
  /Applications and settings files write-denied; network open; bad agent id throws; resolver lists
  agents from a temp HOME, treats a missing folder as empty, fails closed on an unlistable one.
- `agent-runner-sandbox.test.ts` (8): the SDK `query` options carry the sandbox + rules for every
  profile (manual/Agents page, heartbeat, channel, asana, voice conductor, iMessage) and for a
  bypass-permissions agent; a policy failure rejects the run and `query` is never called.
- The five existing `agent-runner-*.test.ts` files mock `./agent-sandbox-policy` (their harness has no
  Electron `app`).

### Mutation checks (each seen failing, then restored)

| Mutation | Result |
|---|---|
| runner drops the policy (`Object.assign` removed) | 8 failed |
| runner drops `sandbox` only / `disallowedTools` only (earlier form) | 7 / 7 failed |
| `allowUnsandboxedCommands: true` | 8 failed |
| own folder not re-opened (`allowRead: []`) | 8 failed |
| other agents not write-denied | 10 failed |
| credentials not denied | 8 failed |
| home not writable | 1 failed |
| any listing error treated as "no agents" | 2 failed |
| network closed (`allowedDomains: []`) | 1 failed |
| own agent listed as other | 1 failed |
| settings Edit rules dropped | 1 failed |
| agent id not validated | 1 failed |

Verification: `pnpm run typecheck` exit 0. Targeted: `src/main/agents`, `src/main/voice-conductor`,
`agent-provider.test.ts`, `workflow-executor.test.ts`, `custom-agents.test.ts` → 484 passed, 1 failed
(`agent-provider.test.ts` "subscribe streams…", in `basefail.txt`, fails the same alone 3/3; it mocks
`agent-runner`). Full suite deferred to the coordinator.

## Decisions for Carson (every restriction the sandbox adds)

1. Sandbox on for every Claude agent run (all profiles, bypass mode included), fail closed: on a
   platform where it cannot start (Linux without bubblewrap/socat, Windows without the sandbox
   install) runs end with an error instead of running unconfined.
2. No `dangerouslyDisableSandbox` escape hatch (`allowUnsandboxedCommands: false`).
3. Bash cannot read: the agents folder except the run's own agent (the shared `_crew` folder too),
   Claude credential files, `~/.dobius` token/`.enc` files, `~/Library/Messages`, and userData
   account/auth/daemon/cookie folders. Read/Grep/Glob are denied the same (per existing agent).
4. Bash cannot write: other agents' folders and `_crew`, `~/.local/bin/dobius-*`, `/Applications`,
   Claude settings files (`~/.claude/settings*.json`, `~/.claude.json`, account config dir, and every
   project's `.claude/settings*.json`, also via the Write/Edit tools), and the secret folders above.
   Everything else in the home folder and temp stays writable.
5. Built-in CLI protections now apply to agent Bash: `.git/config` and `.git/hooks` in the project
   are read-only. `git push -u` still pushes (exit 0) but cannot record the upstream; `git config`,
   `git remote add`, tracking-branch checkout fail. Not configurable from settings in CLI 2.1.282.
6. All network egress from Bash goes through the sandbox proxy with every domain allowed. Tools that
   ignore `HTTP(S)_PROXY` (ssh git remotes, raw sockets to external hosts) cannot reach the internet.
   This machine's remotes are HTTPS. Public-host reachability through the proxy was not tested (no
   external network allowed during the build).
7. Unix sockets and localhost ports stay open (dobius CLI, ssh-agent, docker, test servers).
8. `dobius-runtime.json` (holds the runtime auth token) stays readable so the voice conductor's
   `dobius-*` commands keep working.

## Residual gaps (not fixed here)

- Agents created after a run starts are covered for reads (whole folder denied) but not for writes or
  for the Read/Edit tools until the next run.
- Other agents' Claude transcripts in `~/.claude/projects` stay readable (they can quote another
  agent's memory). `~/Library/Keychains` is left out of the sandbox (Security.framework may read it
  in-process; the rails still deny it by path).
- A repo that already ships `.claude/settings*.json` with `sandbox.filesystem.allowRead` can re-open
  denied paths (a hostile repo can also run unsandboxed hooks; out of this threat model).

## Rollback

Revert the commit. The runner goes back to rails-only; no data or config is migrated.

## Deviations

- `agent-runner.ts` stays over `max-lines` (493 → 495 counted lines; pre-existing violation). Policy
  lives in the new module as the brief asked.
- The five existing runner test files got one `vi.mock('./agent-sandbox-policy')` each.
- Settings-file write protection (point 4) goes beyond the brief's list; it closes a sandbox bypass
  found during verification.

## Lessons

- Claude Code's sandbox is only for Bash. The file tools need permission deny rules on the same paths.
- `allowRead` merges from every settings source, so any file the agent can write that the CLI loads as
  settings is part of the sandbox's trusted base.
- A localhost Messages-API stand-in plus the real CLI checks enforcement end to end with no API cost.
