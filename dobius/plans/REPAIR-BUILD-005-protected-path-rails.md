# REPAIR BUILD-005 — protected-path rails (#3 #4 #23 #76)

## Root cause
- **#3 (A1)** `agent-hard-rails.ts` `rawStringMentionsCredential` only matched the literal text
  `~/.claude/...`; the prefix check in `targetsCredentials` compared the WHOLE Bash command string
  with `startsWith(<home>/...)`, so any credential path that was not the first word
  (`cat /Users/bayou/.claude/.credentials.json`) or was spelled `$HOME/…` / `${HOME}/…` passed.
  Symlinks were never resolved.
- **#4 (A14)** `targetsOtherAgentIdentity` reference regex required `~` or an absolute prefix of
  the form `/…/.dobius/agents/`; `$HOME/.dobius/agents/<other>` has only one slash before
  `.dobius`, so it never matched. No symlink resolution either.
- **#76 (A16)** force-push rail: `/\bpush\b[\s\S]*(... -[A-Za-z]*f ...)/` scanned everything after
  `push` across `&&`/`;`, so `rm -rf` in a later command read as `-f` → `git push && rm -rf dist`
  denied.
- **#23 (orig #3)** `agent-runner-environment.ts ensureRunCwd`: `catch { return os.homedir() }` —
  a folder that could not be created silently ran the agent in the home folder. An existing but
  unwritable folder was accepted (mkdir recursive succeeds on it).

## Fix
- `protected-path-guard.ts`: new exported `realpathPreservingMissingTail()` (resolve the deepest
  existing ancestor through symlinks, re-append the missing tail). Existing
  `realpathNearestExisting` / `assertPathOutsideProtectedRoots` untouched. The guard had no
  `$HOME`/`~` expansion, so only the symlink part is shared.
- `agent-hard-rails.ts`:
  - `expandHomeReferences()` replaces `expandHome()`: expands `$HOME`, `${HOME}`, `~`, `~user`
    anywhere in a string (word-start only for `~`, so `HEAD~1` is untouched).
  - `candidatePaths()` extracts every absolute path token from the (expanded) string and yields it
    normalised AND symlink-resolved. `protectedForms()` gives each protected location as written
    and realpath-resolved (covers a symlinked `~/.claude`).
  - Credential rail checks every candidate against the prefixes (same set and `.dobius/**/token*`
    rule as before). Name-based raw checks made prefix-agnostic (`.claude/credentials*`,
    `.dobius/<no-space>/token*`, `Library/Keychains`) plus bare `.credentials.json` as a word (same
    treatment `.env` already had) — catches `/Users/$USER/…` and `cd ~/.claude && cat .credentials.json`.
    The `.dobius/.*token` regex was tightened to not span across spaces (was greedy across the
    whole command: `ls ~/.dobius/ && cat src/tokenizer.ts` false-denied).
  - Identity rail checks candidates (incl. realpath) against the agents root and runs the
    reference regex on the expanded string.
  - Force-push: `isForcePush()` splits the command into shell segments (`&& || ; | & \n ( ) \``),
    finds `git … push` inside one segment, then checks only that segment's arguments
    (`--force*`, short cluster containing `f`, `+refspec`).
- `agent-runner-environment.ts`: `ensureRunCwd` runs `mkdirSync` + `accessSync(W_OK)`; on failure
  throws `Agent working folder cannot be used: <path> (<detail>)`. Both callers in
  `agent-runner.ts` (codex :305, claude :335) are inside the `try` before `addRun`, so the run is
  rejected, the reservation released, and the error propagates to the caller.

## Tests
- `agent-hard-rails.test.ts` (extended): literal `/Users/<u>`, `$HOME`, `${HOME}`, quoted,
  `~user`, `$USER`, `cd … && cat .credentials.json`, mid-command, `..`, `//`, Keychains, dobius
  token; other-agent identity via `$HOME`/`${HOME}`/`$USER`/mid-command; own identity + ordinary
  `.claude`/`.dobius` reads allowed; `git push && rm -rf dist` and friends allowed; `-f`, `--force`,
  `-uf`, `--force-if-includes`, `(… git push origin +main)` denied; real-fs symlinks (file link,
  dir link to Keychains, link into agent-b, link reached via `$HOME`/`${HOME}`/`~`) denied,
  harmless symlink allowed. HOME is overridden per test (os.homedir honours $HOME); fixtures are
  placeholder bytes in a tmp dir.
- New `agent-runner-environment.test.ts`: missing folder created; uncreatable folder (0500 parent),
  existing unwritable folder (0500), and file-as-cwd all throw — never return home.
- Mutation checks (each made the targeted tests fail, then restored):
  M1 no segment split (1 fail), M2 no home expansion (1 fail, after adding the `$HOME`-symlink
  test — the first run survived because name checks alone caught the non-symlink spellings),
  M3 no realpath candidate (3), M4 no bare `.credentials.json` (2), M5 catch returns homedir (3),
  M6 no W_OK check (1).

## Verification
- `pnpm run typecheck` exit 0.
- `npx vitest run src/main/agents/ src/main/communications/providers/protected-path-guard.test.ts`:
  15 files / 114 tests green (before the `$HOME`-symlink test was added; the two targeted files are
  36/36 after).
- oxlint + react-doctor config: clean on all 5 changed files (checked one file at a time).
- Full suite: DEFERRED (coordinator).

## Deviations from EXECUTION-ORDER.md
- Touched `communications/providers/protected-path-guard.ts` (listed as reuse candidate): added one
  exported helper; existing functions unchanged.
- `.dobius/**/token*` rule kept as before (any file whose name starts with `token` under `.dobius`
  is denied, e.g. `tokenizer-ideas.md`) — pre-existing, out of scope.

## Decisions for Carson
- An existing agent folder that is not writable now rejects the run (spec: "unwritable cwd →
  rejected"). A read-only analysis folder would need to be writable or the check relaxed to
  "exists and is a directory".
- Bare `.credentials.json` anywhere in a Bash command is denied (e.g. `grep -r .credentials.json src`).

## Known limits (rails are defence in depth, not a sandbox)
- Variable indirection (`H=$HOME; cat $H/work/link`) and relative paths after `cd` into a symlinked
  dir are not resolved; the prefix-agnostic name checks still catch the known credential names.
- A dangling symlink that points at a still-missing protected root is not followed (realpath
  fails, so the link is treated as a plain missing path). If the root is created later, the link
  leads into it.

## Follow-up commit (coordinator request): missing protected root widened to home
- Root cause: `assertPathOutsideProtectedRoots`' symlink pass used `realpathNearestExisting(root)`,
  which DROPPED the missing tail. A root that does not exist (no `~/.gnupg`, `~/.aws`) therefore
  became its parent, the home folder, and every candidate under home was refused. That hit
  `custom-harness-provider.ts:87` (harness cwd) and `media-commands.ts:56` (uploadMedia).
- Fix: both sides of the symlink pass now use `realpathPreservingMissingTail`, so a missing root
  protects exactly its own path (and anything later created under it). `realpathNearestExisting`
  had no other users and was removed. The literal pass is unchanged.
- Tests (`protected-path-guard.test.ts`): a missing root leaves `work/notes.txt` and the base dir
  allowed. The missing root and `.gnupg/private-keys-v1.d/k.key` are refused. A missing root under a
  symlinked parent still refuses the real-path route in and allows a sibling file. Two of these
  failed before the fix. Existing root tests are unchanged and green. Callers'
  tests (custom-harness-provider, media-commands) green.
- Mutation checks: M7 drop the tail again (9 fail across guard and rails tests), M8 compare the root
  unresolved (3 fail).

## Rollback
Revert the commit; rails return to the regex form and cwd failure falls back to home again.

## Second follow-up (review findings F1-F3)
- **F1 case-insensitive filesystems.** APFS/NTFS open `~/.Dobius/Agents/OTHER` as the agents
  folder, but every comparison was case-sensitive. `protected-path-guard.ts` now exports
  `comparablePath()` (lower-cases on darwin/win32 only). `isWithin` folds both sides. The rails
  fold every candidate, every protected prefix and the own agent id, and the reference regex uses `i`.
- **F2 relative / quoted routes into the agents folder (Bash only).** Bash strings are unquoted
  the way the shell would (`"`, `'`, `\` removed) before matching. A Bash reference that stops at
  `.dobius/agents` (no id) or at `<home>/.dobius` itself is denied, because a `cd` there reaches every
  agent through relative paths. `..` in a command that references the agents folder is denied (own folder
  then `../other`). The `<home>/.dobius` rule is anchored to the home folder because repos have their
  own `.dobius` folder (hooks.ts:107, ipc/worktrees.ts:2143). `ls .dobius` in a repo stays allowed.
- **F3 cost.** `realpathPreservingMissingTail` walks up with `existsSync` and calls `realpathSync`
  once on the first existing ancestor; a resolvable-but-failing entry (EACCES/ELOOP) is treated as
  missing. Candidates are computed once per tool call (`inspectStrings`) and shared by both rails.
  Only the first 64 path tokens per call are symlink-resolved; the rest get lexical and name checks.
- Tests: case spellings (Write/Edit/Bash, own id in other case allowed; guard `SECRETS/…` and
  upper-cased root; darwin/win32 only via `it.runIf`). F2: 8 Bash spellings denied, own-folder
  `cd` + relative read and repo `.dobius` allowed. F3: 2000 missing 8-level paths evaluate in under 1 s,
  fewer than 100 `realpathSync` calls (pass-through `vi.mock('node:fs')` spy), and a credential path after 200
  tokens is still denied.
- Mutation checks (each failed, then restored): F1 no case fold (2 fail); F2a no empty-id
  deny (2); F2b no home-.dobius rule (1); F2c no `..` rule (1); F2d no unquoting (3); F3a no token
  cap (1, call-count test); F3b throw-per-level walk (1, call-count test). With only the timing test, F3a
  and F3b each survived alone (either fix keeps it under 1 s), which is why the call-count test exists.
- Verification: typecheck exit 0; oxlint + react-doctor clean on the 4 files; targeted 5 files /
  86 tests green. The wider run of src/main/{agents,communications/providers,communications/workstation/media}
  had one failure, agent-provider.test.ts, which is in basefail.txt.
- Updated test: `ls ~/.dobius/ && cat src/tokenizer.ts` is now denied (home `.dobius` rule), so that
  allowed-case assertion became `cat ~/.dobius/notes/ideas.md && …`.
