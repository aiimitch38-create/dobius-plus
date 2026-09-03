# Lessons Learned — Dobius+

> This file is READ at the start of every session and APPENDED TO whenever a mistake is made or a non-obvious pattern is discovered.
> It accumulates institutional knowledge across sessions. Never delete entries — only mark outdated ones.

---

<!-- New lessons are appended below this line -->

### [Deployment] — 2026-04-30
- **MISTAKE**: Released v1.0.3 with the auto-updater wired up, but Brett's app silently failed to update. The bug: `latest-mac.yml` referenced `dobius-plus-1.0.3-arm64-mac.zip` while the actual uploaded file was `Dobius+-1.0.3-arm64-mac.zip`. The download URL 404'd, so `electron-updater` aborted silently with no user-visible error.
- **FIX**: `electron-builder` defaults the `artifactName` to use `${productName}` ("Dobius+") for filenames, but writes `latest-mac.yml` URLs using `${name}` ("dobius-plus") from `package.json`. They never match unless you pin `artifactName` explicitly. Added to `electron-builder.yml`:
  ```yaml
  mac:
    artifactName: ${name}-${version}-${arch}-mac.${ext}
  dmg:
    artifactName: ${name}-${version}.${ext}
  ```
  After this, the YAML's `url:` fields match the actual filenames. v1.0.4+ ships clean. v1.0.3 was patched by re-uploading renamed copies via `gh release upload --clobber`.
- **CONTEXT**: This is silent — there is no warning at build time, no error in the published release, nothing in `electron-updater`'s logs unless you enable verbose logging. The only way to detect it is to fetch `latest-mac.yml` from the release and HEAD-check each `url:` field.
- **DETECTION**: `python3 -c "import urllib.request; print(urllib.request.urlopen('https://github.com/statusdigitalmarketing/dobius-plus/releases/latest/download/latest-mac.yml').read().decode())"` — confirm each `url:` line is a filename that exists in the release assets list (`gh release view vX.Y.Z --json assets --jq '.assets[].name'`).

### [Build] — 2026-04-30
- **MISTAKE**: `electron-builder` v26 doesn't auto-sign the DMG container. The .app inside is signed and notarized via the build, but double-clicking the DMG itself triggers a Gatekeeper warning because the wrapper isn't signed. Caught by Brett seeing "Apple could not verify..." after his first install attempt.
- **FIX**: Manual post-build step — `codesign --sign <hash> --timestamp <dmg>`, then `xcrun notarytool submit --wait`, then `xcrun stapler staple`. See RELEASING.md step 3. Until automated, this MUST happen for every release or first-time installs will hit the warning.
- **CONTEXT**: The .app inside the DMG passes Gatekeeper because notarization stapled to it. But macOS's `spctl -a -t install` evaluates the DMG container separately. `electron-builder` v26 has no built-in toggle to sign the DMG; it's a known limitation.
- **DETECTION**: `spctl -a -vvv -t install dist-electron/dobius-plus-*.dmg` — should report `accepted, source=Notarized Developer ID`. If it says `rejected, source=no usable signature`, the DMG wasn't signed.

### [Configuration] — 2026-04-30
- **MISTAKE**: Used `notarize: { teamId: "..." }` (object form) in `electron-builder.yml`. electron-builder v26 changed the schema — `notarize` is now a boolean only. Build failed with `notarize: should be a boolean`.
- **FIX**: Use `notarize: true`. Team ID comes from the `APPLE_TEAM_ID` env var, not the YAML.
- **CONTEXT**: This is a v25 → v26 breaking change. The `notarize` object form was the recommended config for v25 and earlier; older docs/blog posts still show that.
- **DETECTION**: Build error message mentions `notarize: should be a boolean`. Or grep electron-builder.yml: `grep -A2 "notarize:" electron-builder.yml` — if it has nested fields, it's the old format.

### [Configuration] — 2026-04-30
- **MISTAKE**: Used `mac.identity: "Developer ID Application: Status Consulting Firm LLC (Z349CC556Z)"` (full cert name) in `electron-builder.yml`. Build failed with `Please remove prefix "Developer ID Application:" from the specified name`.
- **FIX**: Strip the prefix — `identity: "Status Consulting Firm LLC (Z349CC556Z)"`. electron-builder picks the right cert when both Apple Distribution and Developer ID Application certs exist for the same team. (Note: when calling `codesign` directly, this same name is *ambiguous* and you must use the SHA hash. Different tools, different conventions.)
- **CONTEXT**: electron-builder enforces this naming convention. The cert in Keychain shows the full name, which is misleading.
- **DETECTION**: Build error message mentions `remove prefix "Developer ID Application:"`. Grep: `grep "identity:" electron-builder.yml` — value should NOT start with "Developer ID Application:".

## Pre-populated rules — audit 2026-06-13

> Appended, not overwritten; only rules not already present above. These runtime/build gotchas were documented in the root `CLAUDE.md` but were missing from this lessons file. Each is a standing rule.

- **Never use null bytes (`\x00`) in `execFile` args** — Node throws `ERR_INVALID_ARG_VALUE`. Use a text separator like `||SEP||` instead (see `git-service.js` commit-log format).
- **Dev process name is `"Electron"`**, not the app name — use `tell process "Electron"` in AppleScript during dev. The display name only applies to packaged `.app` builds.
- **`build-and-install.sh` MUST `rm -rf` the old `.app` before `cp -R`** — asar overwrite issue. Do not "optimize" that step away.
- **All terminal tabs stay mounted (CSS `display:none`)** — unmounting a tab kills the xterm buffer + the underlying PTY.
- **Native modules need `electron-rebuild`** (`node-pty`, `better-sqlite3`) after any dependency change, or the app fails to load the native addon at launch.
- **Remove the `remote-debugging-port` switch before shipping** (it enables CDP for Playwright/testing). Not currently present in `main.js` — treat this as a pre-ship check, keep it absent in release builds.
- **`~/Library/Application Support/Dobius/config.json` is managed by `config-manager.js` — do NOT hand-edit.**
- **The working tree currently has a large in-flight dashboard feature uncommitted** (Costs/Prompts/Search/ChangeFeed + a file-change service). Review and branch deliberately before building over it; don't blow it away.

## Asana queue (Auto Mode) — 2026-06-14
- **Asana `/tasks` query cannot combine `project` + `assignee`.** Asana returns HTTP 400 "Must specify exactly one of project, tag, section, user task list, or assignee + workspace". `fetchNewTasks` in `electron/asana-queue.js` must query by **project only** (`?project=<gid>&completed_since=...&opt_fields=<incl. assignee>`) and filter to the lane assignee **client-side** (`t.assignee?.gid !== gid`). Reintroducing `&assignee=` in that URL silently breaks every Auto Mode poll.
- **Auto Mode runs in the INSTALLED app, not dev.** Any `electron/` change (e.g. the token fallback or the query fix) only takes effect after `./build-and-install.sh`. The installed app reads the Settings PAT via `asanaToken()` (`process.env.ASANA_PAT || getAsanaQueue().pat`) — a Finder-launched app has no env PAT, so the config `pat` fallback is required.
- **Verify the queue end-to-end via the bridge**, not just config: `POST http://127.0.0.1:8421/asana/fetch` with `{ "projectName": "<allowlisted name>" }` and the token from `userData/voice-bridge-token`. `ok:true` + non-empty `tasks[]` means detection works through the live app. `seen[]` in `config.asanaQueue.autoMode` filling to `MAX_TASKS_PER_TICK` (3) confirms a poll actually dispatched.

### [Architecture] — 2026-06-12
- **MISTAKE**: `work-registry.js` `rehydrate()` restored persisted items from `config.workRegistry.items` verbatim, including `status: 'running'`. A `running` item cannot survive a process restart (its PTY/tab is gone and rehydrate never recreates a watcher), so it sat `running` forever. The concurrency cap in `registerWork` counts running items (`running.length >= maxConcurrentAgents`, default 1), so a single phantom-running item from a prior session permanently blocked ALL new Conductor/iMessage work dispatch with `concurrency cap: 1/1 agents already running` for a tab that no longer existed.
- **FIX**: In `rehydrate()`, reconcile any persisted `status === 'running'` item to `'interrupted'` (stamp `completedAt`/`lastUpdate`/`finalReport`), then `persist()`. Do NOT fire a final-report iMessage on rehydrate (would spam on every launch) — it's a silent status fix. The cap then counts only genuinely-running (current-session) items.
- **CONTEXT**: Classic stale-persisted-state bug. Any state that means "a live process exists" (running/active/in-flight) must be reconciled on load, because the process it referred to died with the previous session. Applies to anything persisted that implies a live OS resource.
- **DETECTION**: `grep -n "status === 'running'" electron/work-registry.js` — rehydrate must reconcile, not just `items.set(e.workId, e)`. Verified via before/after ship-test in /tmp: a seeded `running` item blocked `registerWork` (ok:false) pre-fix, registered fine (ok:true) post-fix, while the cap still blocked a genuine second concurrent agent.

### [Build] — 2026-06-12
- **MISTAKE**: App crashed on launch with `Uncaught Exception: ReferenceError: completed is not defined` at `electron/voice-bridge.js:638`. The CLI helper scripts (`CLI_*_SCRIPT`) are authored as JS **template literals** (backtick strings). Line 638 was `STATUS="${3-completed}"` (bash default-value expansion). Inside a backtick string, JS parses `${3-completed}` as the interpolation `${3 - completed}`, evaluates it at module load, and `completed` is not a JS variable, so the whole main process throws before the app window can open.
- **FIX**: Escape the `$` so it stays literal bash: `STATUS="\${3-completed}"`. Any bash `${...}` brace-expansion inside these template-literal scripts MUST be backslash-escaped. The already-correct siblings (`\${1-}` line 696, `\${1-list}` line 802) show the intended pattern.
- **CONTEXT**: Bare `$1`, `$@`, `$#`, `$*` are safe (no brace, JS ignores them). Only `${...}` is dangerous because JS treats `{` as the start of an interpolation. This bites whenever you add a bash default/substitution to a CLI helper.
- **DETECTION**: `grep -nP '(?<!\\)\$\{[0-9@*#]|(?<!\\)\$\{[A-Za-z0-9_]+:?-' electron/*.js` — finds UNescaped bash brace-expansions inside JS strings. Every hit must have a preceding backslash.

### [Build] — 2026-06-12
- **MISTAKE**: After the v1.0.22 build (built 09:47), EVERY terminal tab opened blank and would not start; new sessions and `claude --resume` both came up empty. Root cause: electron-builder's asar-unpack step stripped the execute bit on node-pty's `spawn-helper` Mach-O binary (bundled at `app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper` as `-rw-r--r--` instead of `-rwxr-xr-x`). node-pty execs spawn-helper to launch the shell behind each PTY; with no +x the exec fails (EACCES), the pty opens but the shell never starts, so the tab is blank. Source `node_modules` copy was correct (0755) — only the packaged copy was broken, which is why it built fine and ran broken.
- **FIX**: Two parts. (1) Immediate: `chmod +x` the installed app's spawn-helper (no app restart needed — spawn-helper is exec'd fresh on each pty.spawn). (2) Permanent: added `build/after-pack.cjs` electron-builder `afterPack` hook that `chmod 0755`s spawn-helper after packing and before signing, so the signature seals the correct mode. Wired via `afterPack: build/after-pack.cjs` in `electron-builder.yml`. Hook throws if spawn-helper is missing (better to fail the build than ship blank terminals).
- **CONTEXT**: Applies after any `npm install` / `electron-rebuild` / version bump that triggers a fresh electron-builder pack. The bit can drop again on any rebuild without the afterPack guard. Known electron-builder + node-pty packaging interaction, not specific to one Electron version.
- **DETECTION**: `test -x "/Applications/Dobius+.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper" && echo OK || echo BROKEN` — run after every build. Also: `ls -la <that path>` should show `-rwxr-xr-x`.

### [Performance] — 2026-06-12
- **MISTAKE**: Clicking into the Dashboard crashed the MAIN process (EXC_BREAKPOINT/SIGTRAP, v1.0.22). Root cause: `DashboardView` mount calls `dataLoadAllSessions()` -> `loadAllSessions()`, which fanned `parseJsonl(file, 5)` across ALL ~/.claude transcript files at once (6,773 files, 927MB). `parseJsonl`'s `limit` arg did NOT limit reading: it `fs.readFile`'d the WHOLE file, `JSON.parse`'d every line, then sliced the last 5 at the very end. One 24MB transcript = +95MB parsed in memory; all of them concurrently = multiple GB = main-process heap OOM = V8 fatal. JS try/catch and uncaughtException handlers CANNOT catch a V8 heap-OOM abort, which is why it surfaced as a bare SIGTRAP crash report with no logged reason.
- **FIX**: (1) `parseJsonl` now reads only a bounded TAIL of the file when `limit > 0` (new `readTail()` reads backward in 64KB chunks, 4MB cap) instead of the whole file. Verified identical last-5/last-100 output vs the old full read, with +0MB vs +95MB memory on a 24MB file. (2) `loadAllSessions` flattens all files into one list and processes them through a new `mapLimit(items, 24, fn)` bounded worker pool instead of nested unbounded `Promise.all` (also prevents EMFILE from thousands of simultaneous opens). (3) Added `setupCrashLogging()` in main.js (uncaughtException/unhandledRejection/render-process-gone/child-process-gone -> userData/crash.log) so the NEXT failure leaves a readable reason. Honest limitation: native (node-pty/sqlite) aborts and V8 heap OOM still produce a system .ips and bypass the JS handlers; the real defense for those is not loading GB into memory (fix 1+2).
- **CONTEXT**: Any IPC handler in the main process that reads/parses unbounded amounts of `~/.claude` data is an OOM risk that grows as transcript history grows. A `limit` parameter is only real if it bounds the I/O, not just the returned slice.
- **DETECTION**: `grep -n "readFile" electron/data-utils.js` — any whole-file read feeding a `slice(-limit)` is the anti-pattern. Also: `du -sh ~/.claude/projects` (927MB at time of bug) shows how much the old loader tried to hold at once.

## 2026-07-09 — zsh eats `echo ===` separators; AppleScript `whose` can't reach deep AX elements
- Tried: `echo ===LABEL===` as an output separator in Bash tool calls (3x), and `click (first button of group 1 of window 1 whose name is "X")` on Dobius+ (Electron).
- Failed because: zsh expands a word starting with `=` as `=command` filename expansion → `== not found`, failing the whole compound command. AppleScript `whose` filters only match DIRECT children; Electron web-content buttons are nested many groups deep.
- Works instead: quote the separator (`echo "===LABEL==="`) or use a non-`=` label. For Electron AX: set `AXManualAccessibility` to true, then iterate `entire contents of group 1 of window 1` and match role+name in the loop.

## 2026-07-09 — Guessed dobius CLI flags the dobius-cli skill already documented
- Tried: `dobius terminal send --submit` and parsing `terminal read` as `result.text`; both failed (`invalid_argument`, KeyError).
- Failed because: drove the dobius CLI without loading the `dobius-cli` skill first — it already documents `--enter` and the tail/cursor read shape. Skill-matching rule skipped.
- Works instead: load `dobius-cli` skill before any dobius CLI session; `--enter` submits, output is `result.terminal.tail`. Runtime discovery should use the Dobius user-data path and `dobius-runtime.json`; terminal handles die when the app restarts (`terminal_handle_stale` -> reacquire via `terminal list`).

## 2026-07-09 — macOS Trash is TCC-protected; agents can't Put Back
- Tried: restoring `~/.Trash/DobiusPlus` to `~/` via `mv`, then Finder AppleScript (`tell application "Finder" to move ...`), then `ditto` — all with sandbox disabled.
- Failed because: macOS TCC protects `~/.Trash` from terminal/automation processes without Full Disk Access; Finder automation also needs a user-granted Apple Events permission the host process lacks. Sandbox off ≠ TCC granted. (Reads of a known subpath partially work — `ls`/`stat` on `~/.Trash/<dir>` succeeded — but directory listing, rename, and copy are denied, so discovery via `ls ~/.Trash` silently returns empty with `2>/dev/null`.)
- Works instead: detect trashed items via `lsof | grep -i <name>` (system daemons like StorageManagement hold handles) or `stat ~/.Trash/<expected-name>` directly; then have the USER restore: Finder → Trash → right-click → Put Back. Don't burn attempts on mv/osascript/ditto.

## 2026-07-12 — Reading macOS plists: never pipe through `plutil -convert json`
- Tried: `defaults export com.apple.dock - | plutil -convert json -o - -` to inspect Dock recents, then a hacky `/tmp/../private/...` scratchpad path as fallback.
- Failed because: system plists carry binary `<data>` blobs that JSON cannot represent, so `plutil -convert json` exits non-zero; the fallback then died on the malformed path.
- Works instead: `defaults export <domain> "$FILE"` (plain absolute path) then Python `plistlib.load()` — it parses binary plists and `<data>` natively. For targeted edits use `/usr/libexec/PlistBuddy -c "Delete :key:index"`.

## 2026-07-12 — Repeated the documented `echo ==` zsh failure while chaining probes with &&
- Tried: separator-labelled compound probes like `git grep ... && echo == && git grep ...` and `grep ... && ls vitest*` during the daemon debug session.
- Failed because: (a) bare `==` hits zsh's `=command` expansion (`= not found`) — ALREADY documented in learned-macos-shell-quoting, ignored in the moment; (b) joining probes with `&&` makes a legitimate no-match exit (grep/ls returning 1) kill every later command in the chain, so one empty probe costs the whole call.
- Works instead: separators are quoted plain words (`echo "== label =="` or `echo '--'`), and exploratory probes are joined with `;` (or run as separate calls) so a no-match can't cascade. `&&` is only for steps that truly depend on the previous one succeeding.

## 2026-07-12 — Install script's pkill murdered the terminal daemon (all sessions lost)
- Tried: `pkill -f "/Applications/Dobius\+\.app"` in install-dobius-v2.sh to stop the app before replacing it (and build-and-install.sh's `pkill -f "Dobius+"` had the same flaw).
- Failed because: `pkill -f` matches the FULL command line — and the detached session daemon runs from inside the bundle (`Dobius+ Helper … daemon-entry.js`), so the "stop the app" kill also executed the daemon. Every live session got endedAt-stamped in the same millisecond; on relaunch nothing restored. Compounding it, the daemon's SIGTERM path marked sessions "cleanly ended", which suppresses cold-restore.
- Works instead: kill by exact process name only — `pkill -x "Dobius+"` for the main app plus `pkill -f "Dobius\+ Helper.*--type="` for Chromium helpers (renderer/GPU have `--type=`; the daemon doesn't). And signal-driven shutdown must NOT mark sessions ended (fixed in daemon-server: `{ markSessionsEnded: false }`), so the next launch restores.

## 2026-07-12 — Validate generated HTML/CSS before publishing an Artifact
- Tried: wrote a large machine-map artifact and moved straight toward publishing it.
- Failed because: a stray hallucinated token slipped into a CSS value (`--warn: #d3a martingale, ;`) followed by a duplicate `--warn:` redefinition — nonsense/duplicate custom-property defs are a real generation failure mode in big inline-CSS files. Also wasted an Edit: trusted remembered whitespace on a just-written (auto-reformatted) file instead of re-reading the exact region first.
- Works instead: before calling Artifact/publish, grep the file for duplicate `--custom-property:` defs and obviously-non-token words in values; fix, THEN publish. For any Edit on a large just-generated file, Read the exact target lines first — don't reconstruct whitespace from memory.

## 2026-07-12 — Concurrent agent builds clobber each other in this shared checkout
- Tried: verifying my finished `dist/mac-arm64` artifact right after my background build exited 0.
- Failed because: another agent had started its own `rm -rf out dist && pnpm run build:unpack` in the same checkout — its clean step deleted my finished artifact between build-exit and verify.
- Works instead: before ANY dobius build, `pgrep -f "run-electron-vite-build|electron-builder"` — if a build is live, wait and adopt its artifact instead of racing. Verify/install the artifact IMMEDIATELY after build exit, and treat build→verify→install as one uninterruptible sequence.

## 2026-07-14 — Duplicate Dobius+.app bundles (same bundle ID) → double Dock icon / wrong app opens
- Tried: relaunching + reinstalling to clear a "two D+ icons in Dock / keeps opening the wrong app" problem; also launched the app via its raw binary (`/Applications/Dobius+.app/Contents/MacOS/Dobius+`) to capture ELECTRON_ENABLE_LOGGING renderer output.
- Failed because: TWO app bundles carried the identical `CFBundleIdentifier` `com.statusdigitalmarketing.dobius-plus` — `/Applications/Dobius+.app` (canonical) and a handoff copy `~/dobius-handoff/Dobius+.app`. macOS keys apps by bundle ID, so LaunchServices registered both and the Dock could not match the running process to the pinned tile → duplicate icon + ambiguous launch. Separately, launching by the RAW BINARY gives the process its own Dock tile distinct from the normal bundle launch, which ADDED a spurious second icon and looked like a new bug to the user.
- Works instead: keep exactly one bundle. `lsregister -u <stale.app>` ; `lsregister -f /Applications/Dobius+.app` ; quit the app (kill only `/Applications/Dobius+.app/Contents/MacOS/Dobius+`, never the detached daemon Helper running `daemon-entry.js`) ; relaunch via `open -a "/Applications/Dobius+.app"` (NOT the raw binary) ; `killall Dock`. Durable: move/trash the stale copy so it can't re-register (a `*.noindex` containing folder blocks Spotlight/LS re-registration). Verify: `lsregister -dump | grep 'Dobius+.app'` shows ONLY `/Applications`. An `.app` is program code only — user data lives in `~/Library/Application Support/dobius-plus/`, so moving/trashing a duplicate `.app` loses nothing.

## 2026-07-15 — `git add <path>` fails "pathspec did not match" when the path was already `git rm`'d
- Tried: staging a commit with one `git add <a> <b> <deleted.ts> ...` list (chained `&& git commit`) that included a file already removed earlier in the same sequence with `git rm` — happened twice (`engine-parity-checklist.ts`, then `shared/manager.ts`).
- Failed because: `git rm` STAGES the deletion immediately. A later `git add` of that now-nonexistent path errors `fatal: pathspec '...' did not match any files` (exit 128), which aborts the whole `git add` AND the chained `git commit`. Nothing gets committed.
- Works instead: files removed with `git rm` are already staged — never re-list them in a subsequent `git add`. Stage only the still-present modified/new paths; the deletion rides along into the commit. When unsure, `git status --short` first: a `D ` prefix means already staged for deletion, so leave it out of `git add`.

## 2026-07-15 — Line-number `sed -i '' 'A,Bd'` to delete a code block over-deleted and broke JSX
- Tried: removing a nav-button JSX block from `SidebarNav.tsx` with `sed -i '' '78,98d'` using line numbers from an earlier grep.
- Failed because: the block's true end had shifted vs the grep, so the range ate two extra lines (`<SidebarTaskNavButton />` and a `{cond ? (` opener), leaving a dangling `) : null}` — a compile error typecheck caught but the raw diff hid.
- Works instead: for deleting a code block, prefer `Edit` with the block's exact text (content-anchored, not line-anchored). If using line-range `sed`, re-`sed -n 'A,Bp'` to PRINT the exact range and eyeball both boundaries immediately before deleting, then re-run typecheck.

## 2026-07-15 — AI-slop capability dumps to a human stakeholder got rejected as "essay / AI slop"
- Tried: answering Sam's Asana pushback by posting several long, bold-headed, bulleted "here's everything V2 does better" capability lists (engine, UI, automations, folder grouping), each AI-written and exhaustive.
- Failed because: to a real person it read as AI slop — too long, listy, symmetrical, defensive, obviously machine-generated. Sam: "i need tldr this is an essay... AI slop is the opposite of what we're going for." The verbosity buried the point; rebutting every feature read as defensive; the length dwarfed his two-line message.
- Works instead: when writing to a HUMAN (Asana/Slack/email/PR-for-reviewers), lead with the one point, keep it to a few plain sentences roughly the length of what they wrote, concede first, drop exhaustive feature lists and bold-header bullet walls, pick only the 1–2 things that matter to THAT reader, and end with a concrete next step. If the content genuinely wants to be a 7-item list, it belongs in a doc/PR body you link, not pasted as a message.

## 2026-08-05 — Ad-hoc Playwright script burned 3 runs on setup a skill already documented
- Tried: writing a scratchpad `.mjs` to headlessly render and screenshot a WebGL shader, using a bare `import { chromium } from 'playwright'` and a plain `chromium.launch()`.
- Failed because: (a) ESM resolves imports from the SCRIPT's directory, so a scratchpad script sees no `node_modules` → `ERR_MODULE_NOT_FOUND`; (b) `dobius/`'s playwright 1.59.1 wants `chromium_headless_shell-1217` but the cache only has `chromium-1228` (headed) → "Executable doesn't exist"; (c) an escaped `"\$S"` inside a `perl -0pi -e` one-liner reached perl as a literal `$S` instead of the shell var. Root cause for (a) and (b): `learned-playwright-standalone` already documents both and was not read before writing the script — the skill-matching default was skipped because the script "looked trivial".
- Works instead: check `ls ~/.claude/skills/ | grep learned-` BEFORE writing any ad-hoc tooling script, not after it fails. For this repo specifically: keep the script in the scratchpad and resolve the package with `createRequire('<repo>/dobius/package.json')`, then launch with an explicit `executablePath` pointing at the headed `chromium-1228` build in `~/Library/Caches/ms-playwright`. For (c), pass shell variables via `perl -e '...' "$VAR"` / `@ARGV` or just use the Edit tool — never interpolate an escaped `\$VAR` into a quoted perl program.

## Never ship to the installed app what you haven't watched run
_2026-08-05 · claude_

Three failures in one night, all the same root cause: shipping code verified only by
typecheck/tests to `/Applications/Dobius+.app`.

1. **Replaced the whole Communications UI with one screen.** The native port implemented
   only the DM inbox; switching `BuzzPage.tsx` from the webview to it silently deleted
   every other Buzz screen (channels, agents, search) from the tab. Typecheck was clean.
   Never swap a tab's implementation wholesale — add the new surface alongside and switch
   only when it is provably better.
2. **No error path = a silent hang.** `startDmWithAgent` had no `catch` and rendered no
   error, so a failing relay publish showed "opening…" forever with nothing in the UI.
   Every command needs a defined failure render. This is already a rule in the
   `reverse-engineer-repo` skill (C3 item 6) and it got skipped.
3. **`git checkout --` reverted TWO stacked uncommitted layers, not one.** `BuzzPage.tsx`
   had an uncommitted webview-loader fix UNDER the uncommitted native switch. Reverting
   landed on a much older committed version that reads `VITE_BUZZ_UI_URL` and renders a
   fallback page when unset — i.e. the "restore" would have shipped a placeholder.
   **Before `git checkout` on a dirty file, diff it against HEAD and read what HEAD
   actually contains** — do not assume the committed version is the last good one.

Caught #3 only by grepping the BUILT bundle for the URL it must contain
(`asar extract` → `grep buzz/index.html`) and finding zero. Verify the artifact, not the
build's exit code.

## Process-name matching lied three times in one session
_2026-08-05 · claude_

`pgrep -f "daemon-entry"` returned nothing while `ps aux | grep daemon-entry.js` found
PID 1102 alive. Same class as the known `Dobius+` regex trap (NOTES 2026-08-02). Also hit
it with a single-line `grep "ipcMain.handle('x'"` that missed multi-line registrations and
produced a false "NO HANDLER" alarm.

Rule: a negative result from a process/code pattern match is not evidence of absence.
Confirm with a second, differently-shaped query before reporting anything as missing.

## The daemon genuinely survives install (verified)
_2026-08-05 · claude_

Two full install cycles tonight: quit → `rm -rf` the app → `ditto` the new one → relaunch.
Daemon stayed **PID 1102** both times, socket and token intact. Carson was right; the
`pkill -x "Dobius\+"` + `pkill -f "Dobius\+ Helper.*--type="` pattern does not touch it.
Installing is safe for live terminal sessions.

## 2026-08-18 — zsh nomatch killed 3 read commands; the skill that prevents it already existed
- Tried: `grep -rn ... --include=*.ts`, `grep -rn ... --include=*.tsx`, and `ls vitest.config* vite.config*` — all unquoted globs.
- Failed because: zsh's `nomatch` option ABORTS the entire command when a glob matches nothing, unlike bash which passes the pattern through. The command dies with "(eval):N: no matches found: <pattern>" and every other part of the compound command silently never runs — so it reads as "that file/setting doesn't exist" when in fact nothing was checked.
- Works instead: quote every glob — `--include='*.ts'`, `ls vitest.config* 2>/dev/null || true`, or use `find`. `2>/dev/null` alone does NOT help: zsh aborts before the command runs.
- Real cost this session: two FALSE regression reports. `ls vitest.config*` aborting made me conclude the vendored Buzz app had no test config, which fed a wrong "the tests are broken" status to the user. It has its own runner (`node --import ./test-loader.mjs --test`), not vitest.
- Meta-lesson (the important one): `~/.claude/skills/learned-macos-shell-quoting` ALREADY documents this exact failure, including `--include=*.tsx` and "no matches found" as trigger phrases. The skill did not fail — it was never consulted. Countermeasure is a sharper trigger on the skill, not a new skill.

## 2026-08-18 — verify a test command before believing its failures
- Tried: `npx vitest run vendor/buzz-desktop/src/shared/api/` and `npx vitest run src/main/communications/`.
- Failed because: neither path is served by the config being used. The vendored Buzz app does not use vitest at all, and `src/main/communications/` sweeps in `verify/`, which needs its own config for the `@` alias. Both produced import errors that LOOK like code regressions.
- Works instead: read the owning `package.json` scripts / vitest config BEFORE running a suite in unfamiliar territory, and scope the run to the directory that config actually owns.
- Rule: when a suite fails with "Cannot find package" or a whole test FILE fails to load (rather than assertions failing), suspect the runner/config, not the code.

## 2026-08-18 — subagents burn turns on blocked foreground `sleep` because the brief never warns them
- Tried: (subagents) `sleep 8; cat /tmp/rcs-test.out`, `sleep 6; cat ...`, `sleep 5; cat ...` — 3 blocked calls across 2 agents in one session.
- Failed because: this harness refuses foreground `sleep`. Subagents inherit the restriction but not the knowledge of it, so each one burns a turn rediscovering it. My briefs listed the vitest version and the right config paths but never mentioned sleep.
- Works instead: put the whole wait loop inside a `run_in_background` command, or poll on a later turn. And add to EVERY subagent brief that runs a suite: "Foreground `sleep` is blocked — use run_in_background and poll on a later turn."
- Root cause is briefing quality, not agent quality. A subagent knows only what its prompt says; every environment quirk I know and don't write down costs a wasted turn. Covered by an addendum to ~/.claude/skills/learned-background-long-checks (no new skill minted).

## Backgrounding a check does not mean it passed — and `| tail` is not the result
_2026-08-19 · claude_

Committed 190 files across three commits, reported the work as done, THEN the
backgrounded `oxlint` came back red on code inside those same commits. The gate
had passed, so "green" felt earned; typecheck and lint were still running.
Backgrounding a check is a scheduling decision, not a verdict. **Nothing gets
committed or reported complete until every backgrounded check has returned its
real exit code.** If that means waiting, wait.

Compounding it: read the lint output as `npx oxlint ... | tail -3`, saw three
`curly` errors, and treated three as the total. There were **16**, across five
rules including a `max-lines` violation needing a file split. Same family as the
already-recorded `| tail` exit-code trap — a pipe into a truncating command
returns a fragment, and a fragment read as a whole is a false all-clear.
Count first (`grep -c "error "`), group by rule, THEN look at samples.

Third, smaller: guessed at the shape of the gate's `reports/latest.json` twice
(`len()` on an int, then `e['status']` when the field is `verdict`) instead of
printing `list(entry.keys())` once. Two wasted round-trips for a one-line probe.

Cheap remedies, in order: `npx oxlint <dir> > /tmp/lint.txt 2>&1; echo "exit=$?"`
then `grep -c`, then read. Never pipe a verification command into `head`/`tail`.

### [Environment] — 2026-08-24
- **MISTAKE**: Installed the `opencode` CLI with `npm install -g opencode-ai`. npm reported success, but `opencode --version` immediately after failed with `command not found: opencode` (exit 127).
- **FAILED FIRST**: Tried `brew install anomalyco/tap/opencode` first — failed because this Mac's Homebrew Command Line Tools (Xcode CLT) are too outdated to build the `pkgconf` dependency from source. That's a standing environment fact, not fixable in-task (needs an interactive System Settings CLT update or `sudo xcode-select --install`); it blocks brew installing ANY formula that needs a source build, not just opencode.
- **FAILED BECAUSE (npm case)**: `npm config get prefix` on this machine is `/Users/bayou/.hermes/node`, not a directory on `$PATH`. Only `/Users/bayou/.local/bin` is on PATH — `node`/`npm` work there only because they're pre-existing symlinks into `/Users/bayou/.hermes/node/bin/{node,npm}`. A fresh `npm install -g <pkg>` drops its bin into `/Users/bayou/.hermes/node/bin/<pkg>` same as node/npm, but nothing auto-creates the matching symlink in `.local/bin`, so the new command is invisible on PATH even though the install succeeded.
- **FIX**: After any `npm install -g <package>`, symlink the real bin into the PATH'd directory: `ln -sf /Users/bayou/.hermes/node/bin/<bin-name> /Users/bayou/.local/bin/<bin-name>`. Verify with `<bin-name> --version` before reporting the install done.
- **DETECTION**: `npm install -g` exits 0 but the very next invocation of the tool's own name gives `command not found` (exit 127). Confirm root cause with `npm config get prefix` (will print `/Users/bayou/.hermes/node`) and `ls /Users/bayou/.hermes/node/bin/ | grep <bin-name>` (binary is there, just unlinked).
- **See also**: `~/.claude/skills/learned-npm-global-bin-symlink/SKILL.md`.

### [Environment] — 2026-08-25
- **MISTAKE**: None in the code — boot volume hit 0 bytes free mid-diagnosis of "Dobius+ won't launch," and every Bash call failed (including `df -h /` itself) until the user manually freed space.
- **ROOT CAUSE (of the launch failure)**: no `/Applications/Dobius+.app` existed at all (question-mark Dock icon = stale pointer to nothing). A real build exists in `dobius/dist/mac-arm64` but was never installed, and the repo has a large in-progress uncommitted refactor (`feat/computer-use-v2`: `dobius/index.js` deleted, ~20 files modified) — typecheck is clean, so the refactor itself isn't the blocker, disk space was.
- **FIX**: user freed space manually (Homebrew cache + this project's own `dobius/dist`/`dobius/out`, both regenerate on next build). See `~/.claude/skills/learned-enospc-silent-build` for the general recovery procedure now updated with this exact failure mode.
- **NEXT**: once there's durable headroom (consider moving cold node_modules to `/Volumes/Storage`, which has 1.7TB free), rebuild `feat/computer-use-v2` and install via `scripts/install-dobius-v2.sh` (NOT the generic `dobius-build-install` skill — that assumes an existing installed app to repack from, and there currently is none).

### [Fixed] — 2026-08-25
- **RESOLVED**: `/Applications/Dobius+.app` (pid confirmed running) + daemon both alive. Real root causes were two independent things, both now fixed:
  1. Boot disk hit 0 bytes free (see above) — blocked every build/install attempt. User freed space manually.
  2. Once disk was healthy, a real typecheck failure surfaced (masked earlier by the same disk pressure truncating the typecheck log — a textbook case of the ENOSPC "clean-looking but truncated" trap): `src/main/communications/participant-identity-buzz-migration.ts` called undocumented Electron internals `webContents.create()` / `WebContents.prototype.destroy()`, whose type declarations Electron 42 dropped. Fixed by switching to the public, typed `BrowserWindow({ show: false, webPreferences: { partition } })` + `.webContents` + `.destroy()` — same behavior, stable API. Paired test file's mocks updated to match (also fixed several pre-existing loose `ReturnType<typeof vi.fn>` typings there that were silently widening to `Mock<Constructable | Procedure>`).
- Built via `pnpm run build:unpack`, installed via `scripts/install-dobius-v2.sh` (NOT the generic `dobius-build-install` skill — that one assumes an existing installed app to repack from; there wasn't one).
