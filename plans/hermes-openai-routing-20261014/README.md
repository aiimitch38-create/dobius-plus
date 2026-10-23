# Hermes ChatGPT startup and resume repair — 2026-10-14

Adam and Friday use Hermes’s native `openai-codex` OAuth provider and `gpt-6.1-sol`. The root default no longer points at Grok; the sticky interactive default is Adam. Grok-backed `x_search` is disabled in all three CLI configurations. Browser/web tools remain available.

The local launcher exports the selected profile’s `HERMES_HOME` before Python imports resolve auth and session storage. Explicit profile launchers avoid sharing the sticky default between Adam and Friday:

```sh
hermes-adam --continue
hermes-friday --continue
```

To reopen the current named sessions exactly:

```sh
hermes-adam --cli --resume 20261014_135102_157d0a
hermes-friday --cli --resume 20261014_135702_7dfb85
```

Their searchable titles are **Adam - Dobius Chief of Staff** and **Friday - Dobius Research Lead**. `hermes-adam sessions list` and `hermes-friday sessions list` show each profile’s history. Inside a profile, `/resume` lists sessions; use an exact ID or title to avoid stale numeric choices. Plain `hermes --continue` selects Adam unless an explicit profile environment overrides it.

## Verified

- Native provider resolution: `openai-codex`, ChatGPT OAuth, `gpt-6.1-sol` for both profiles.
- Real independent API replies: `ADAM_CODEX_VERIFIED` and `FRIDAY_CODEX_VERIFIED`; receipts are in this directory.
- Eight executable launcher regression tests passed, including sticky/explicit/inherited profiles, resume arguments, and unknown-profile refusal. Shell syntax checks passed.
- Both named sessions appear in their actual native CLI session lists.
- The two existing Dobius tabs were gracefully reopened in those exact sessions. Their real process environments independently identify the correct Adam/Friday profile home; see `live-tabs-verification.json`. An unrelated pending Vercel MCP sign-in was skipped for this launch; its server configuration was preserved.
- Adam’s latest compression continuation was hidden after the older parent was reopened. One conditional metadata repair restored that parent’s original compression close timestamp. All session/message counts were preserved; see `adam-resume-index-repair.json`.

Configuration and launcher backups, plus an online SQLite backup taken before the one-time metadata repair, are private under `/Users/bayou/Documents/Dobius Recovery/hermes-openai-routing-20261014T182142Z`. Existing OAuth stores were neither copied nor replaced. The initial provider-routing repair did not modify Hermes source. The subsequent keyboard repair below changes only the native MCP startup/OAuth input ownership path.

## Account boundary

Dobius’s managed Codex picker selects a `CODEX_HOME` for the **Codex CLI**. Hermes’s `openai-codex` provider owns its OAuth credentials under its selected `HERMES_HOME`. The app picker does not currently select Hermes accounts. The working Hermes connection was verified through each native profile; no automatic picker integration or live unattended job dispatch is claimed. See `../worker-wave-20261014T1825/RESEARCH-hermes-codex-audit.md`.

Adam and Friday are the two requested Hermes agents. Future unattended execution must enforce exclusive ownership of their profiles/homes, rather than concurrently reusing a live interactive profile or silently adding two extra agents.

AWS remains deferred. The historical external Storage queue remains paused.

## Keyboard repair

Normal agent startup formerly opened MCP OAuth browser prompts and daemon stdin paste readers beside the prompt_toolkit composer. A connection timeout could leave its reader alive, consuming user keystrokes. Background agent startup now reserves stdin for the agent for the process lifetime. A fresh MCP authorization challenge refuses with an explicit separate-login instruction before opening a browser, callback listener, or paste reader. Cached authentication and explicit standalone MCP login remain supported; no tools or account credentials were removed.

The native `hermes_cli/mcp_startup.py` and `tools/mcp_oauth.py` changes have four new regressions (two reproduced failures before the fix), 67 existing OAuth tests and four existing startup tests passing: **75 total**. Diff/compile checks passed. Both existing tabs were gracefully reopened and their actual `/version` commands returned responses and restored the input prompt. Friday is brought to the foreground.

Source hashes, backups, and live command proof are in `keyboard-repair.json`; the exact local patch and new tests are preserved in `keyboard-repair.patch`. Provider/profile/session fixes remain intact. Prior unrelated dirty Hermes files were preserved.
