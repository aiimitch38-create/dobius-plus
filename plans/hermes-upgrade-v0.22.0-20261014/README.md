# Hermes v0.22.0 TUI upgrade — 2026-10-14

The latest stable upstream release is active at `/Users/bayou/.hermes/releases/v0.22.0`, exact source `e06df9c2eae6`. The normal command delegates to that release’s native managed launcher. PM supplies Python 3.14.7, Node 26.7.0, npm 12.0.2, uv, ripgrep and ffmpeg; dependencies are pinned and the TUI was built with the upstream source builder.

Adam and Friday have their existing named conversations resumed in the modern TUI. Default/root/Adam/Friday configuration selects the TUI and keeps `openai-codex` with `gpt-6.1-sol`. For later reopening after closing the current session:

```sh
hermes-adam --continue
hermes-friday --continue
```

Exact existing session IDs:

```sh
hermes-adam --tui --resume 20261014_135102_157d0a
hermes-friday --tui --resume 20261014_135702_7dfb85
```

Native `hermes --version` reports v0.22.0 stable. Plain `hermes config path` resolves Adam, and the two aliases resolve their own profiles. Each alias exports `HERMES_HOME` before invoking the upstream launcher. The native installer owns the main launcher now; early profile resolution and background OAuth input suppression are already fixed upstream, so old core patches were not blindly applied. Both live composers displayed an unsent typing-check draft, then Ctrl+U cleared it.

Verification: 82 OAuth/startup tests, 8 TUI resume tests, 30 profile-selection tests and 4 alias tests passed (124 total). The profile tests were run from an isolated tag-exported source copy because the hermetic real-home guard rejects a linked Git worktree’s shared metadata under the actual `.hermes` home. The initial old shell-stub harness was replaced with profile alias checks because upstream now owns the main launcher. Both native profile providers returned actual ChatGPT verification replies. Session/message counts in default, Adam and Friday equal their pre-upgrade snapshots.

The original v0.16.0 checkout, Departments commit, local changes and runtime remain intact at `/Users/bayou/.hermes/hermes-agent`. Secure pre-upgrade launcher/config backups and online SQLite snapshots are recorded in `completion.json`. Old custom web/desktop source remains preserved there; this TUI upgrade does not claim to port that separate feature. A rollback requires closing the active Hermes sessions first and deliberately restoring the saved launcher/configuration; avoid replacing session DBs after new conversation work unless recovering a specific failure.

The isolated test environments and exported test source were removed after success; regenerate a test interpreter through `pm.build_env --group dev --group test --extra all` to rerun upstream checks. Upgrade receipts and the alias test remain in this directory. Normal app data, profiles, credentials, workspaces and the old install were preserved. Optional MCP services still require their individual working connections. No Dobius/VPS deployment or AWS activation occurred; the historical Storage queue remains paused.

Upgrade cache cleanup used native lease-aware generation collection only for this new install and removed its unused bootstrap environment after a process check. The active PM environment, live leases and old rollback installation remain intact. Final free space was 0.96 GiB; storage remains tight.
