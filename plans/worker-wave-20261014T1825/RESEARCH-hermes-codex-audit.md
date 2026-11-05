# Hermes and Dobius Codex account boundary audit

**Wave:** `worker-wave-20261014T1825`  
**Scope:** read-only source and test review; no credential files, `.env`, user session database, service, or provider was accessed.

## Findings

### Account selection and OAuth are separate systems

Dobius’s managed Codex account selector chooses a `CodexManagedAccount` per host/WSL target. `CodexRuntimeHomeService.prepareForCodexLaunch()` synchronizes that selection and returns a Codex runtime home; its tests cover distinct managed homes and host/WSL selection. That is a `CODEX_HOME` boundary for Codex CLI processes. The default Hermes TUI launch in `src/shared/tui-agent-config.ts` is simply `hermes --tui`; this path does not pass the selected Dobius account, a Hermes profile, or an explicit `HERMES_HOME`.

Hermes resolves its `openai-codex` provider credentials from its own auth store: `resolve_codex_runtime_credentials()` reads Hermes provider tokens and falls back to Hermes’s own `openai-codex` credential pool. Hermes’s source explicitly says this Codex OAuth session is separate from Codex CLI/VS Code to avoid refresh-token rotation conflicts. `_import_codex_cli_tokens()` is a separate, explicit login-time import helper; the login flow offers it interactively. It is not a runtime bridge from Dobius account selection and does not make `CODEX_HOME` select Hermes’s provider identity.

**Conclusion:** Dobius-managed Codex account selection does not currently select Hermes’s provider OAuth identity. Pointing Hermes at a Dobius `CODEX_HOME` would not implement that integration and would cross the documented refresh-token ownership boundary.

### Profile/default selection explains the root configuration symptom

Hermes pre-parses `-p/--profile` in `hermes_cli/main.py` before module imports and sets `HERMES_HOME` to that profile. Without an explicit profile, it reads `<Hermes root>/active_profile`; a non-default value is used, while an absent/empty/default value leaves the process on the default Hermes root. An already-profile-shaped `HERMES_HOME` is honored. `hermes profile use NAME` changes this host-global sticky default; it is unsuitable for independently launching two workers because concurrent launches can race over one mutable default.

Hermes profiles also have an important credential-pool caveat: when a named profile has no entries for a provider, `read_credential_pool()` can use that provider’s entries from the global root auth store. A profile name therefore does not, by itself, prove provider-account isolation. Hermes’s custom-home mode is different: if each worker receives its own registered home as both `HOME` and `HERMES_HOME`, Hermes resolves that home as its own root, so the two C05 homes do not share the ordinary `~/.hermes` root fallback. This is a source-level path conclusion, not proof that either home has valid credentials.

At the time of the read-only `hermes profile` command, Hermes reported active profile `adam`, path `~/.hermes/profiles/adam`, model `gpt-6.1-sol`, provider `openai-codex`, and gateway stopped. This verifies only the CLI’s reported profile/config metadata at that moment; no token validity or provider request was checked. The earlier “plain Hermes used root Grok configuration” symptom is consistent with a launch that landed on the default Hermes root, whose root configuration selected Grok. Current profile output is no longer evidence that the same root/default is active; ROOT owns the live configuration correction.

### Session IDs, titles, and compression descendants

`SessionDB.DEFAULT_DB_PATH` is derived from `get_hermes_home()` (`state.db`), so session IDs and title lookup are profile/home-local. CLI `--resume` and `--continue TITLE_OR_ID` first try exact ID, then title resolution; title resolution prefers the latest numbered title lineage. Bare `-c` selects the most recent session by source (`tui` with a CLI fallback for the TUI). The TUI `/resume` command supports a recent-list numeric choice, title, or ID. Resume then follows the compression continuation chain to the descendant holding messages; the DB also bounds traversal. Thus a copied session ID/title must be resumed under the same Hermes profile/home. Hermes’s exit hint adds `-p PROFILE` for named profiles, while custom `HERMES_HOME` deployments rely on the environment being set again.

No session list or user session database was read. Session behavior above is based on the implementation and regression tests only.

## Safe supported account-selection path

- For Hermes provider OAuth, use Hermes’s own authentication in an explicitly selected Hermes profile/home. For parallel `hermes-1` and `hermes-2`, use the C05 registered independent homes and set both `HOME` and `HERMES_HOME` per worker; ROOT owns credential setup and live checks. Do not switch `hermes profile use` as a per-launch selector.
- For an interactive Hermes TUI, a manual supported profile pin is `hermes --profile <name> --tui` (or a fixed, trusted profile-specific `HERMES_HOME`). The current Dobius Hermes launch template does not bind either to a selected Codex managed account.
- Dobius-managed Codex selection remains valid for Codex CLI launches through `CODEX_HOME`. Hermes CLI-app-server use of a Codex CLI home, if separately configured, is distinct from the default Hermes API/provider OAuth flow.

## Concrete app integration gap and next fix

If Dobius must make Hermes identity selectable in the app, add a validated Hermes profile/home binding to the Hermes launch configuration and thread it through the TUI spawn environment (`HERMES_HOME`, with a fixed profile-specific `HOME`) or a trusted `--profile` argument. Add tests proving that two independent Hermes launch registrations resolve to their own homes, that changing Dobius’s Codex selected account does not silently change Hermes OAuth identity, and that resume hints/IDs resolve in the same profile namespace. Do not bridge Dobius’s managed Codex token files into Hermes or pass a `CODEX_HOME` as a substitute for Hermes profile selection. For the already scoped C05 worker path, source currently carries `hermes-1`/`hermes-2` profile IDs, validates distinct registered homes, and constructs a restricted environment with `HOME` and `HERMES_HOME` set to each selected home; remaining provider authentication and runtime verification are ROOT-owned live gates.

`HermesHookService` only installs/checks the Dobius hook plugin under the `HERMES_HOME` it is given. It does not select a Hermes profile, OAuth identity, model, or launch process.

## Evidence and verification limits

Reviewed Hermes source: `hermes_cli/main.py`, `hermes_cli/profiles.py`, `hermes_cli/auth.py`, `hermes_cli/cli_commands_mixin.py`, `hermes_constants.py`, and `hermes_state.py`. Reviewed Dobius source/tests: `src/main/codex-accounts/{runtime-home-service.ts,service.ts,runtime-selection.ts}` and corresponding tests; `src/shared/tui-agent-config.ts`; `src/main/hermes/hook-service.ts` and its test; C05 `src/shared/workstation-worker.ts`, `src/main/automations/workstation-worker/{process-identity.ts,worker.ts}`.

Relevant Hermes regressions reviewed: `tests/hermes_cli/test_apply_profile_override.py` (sticky root versus already-pinned profile), `tests/cli/test_exit_summary_resume_hint.py` (profile-aware ID/title resume hints), and `tests/hermes_state/test_resolve_resume_session_id.py` (compression descendants). These tests were read, not run. No Dobius tests were run. No auth-status command, session listing, token/config file read, provider request, or service action was performed. Dobius source contracts and the one `hermes profile` observation do not establish live credential validity, two-worker authentication, or successful inference; ROOT performs those checks.
