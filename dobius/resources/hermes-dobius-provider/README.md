# Hermes with interchangeable Dobius LLM accounts

`dobius` is a native Hermes model-provider plugin. Hermes keeps the agent loop,
tools, skills, identity, conversations and memory. The plugin supplies inference
through the account currently selected in Dobius. It does not import provider
access or refresh tokens into Hermes's credential pool.

The adapter uses Hermes's supported `ProviderProfile.create_client` interface
and its native Responses/Anthropic codecs. No Hermes core or application rebuild
is required. Restart the selected Hermes profile after installation.

## Routes

| Hermes model, with provider `dobius` | Credential owner |
| --- | --- |
| `codex/auto` | Selected Dobius Codex/ChatGPT account; discover models for this account |
| `codex/<model>` | Selected Dobius Codex/ChatGPT account; pin this model |
| `claude/auto` | Selected Claude CLI runtime account; use its live model catalog |
| `claude/<model>` | Selected Claude CLI runtime account; pin this model |
| `<provider>/<model>` | Another installed Hermes HTTP provider's own credential resolver |

Explicit models never silently change. Auto tries another model only after a
model/entitlement rejection, on the same account. It does not rotate accounts,
retry usage exhaustion with another account, or grant access to unavailable
models. Successful/rejected model hints are scoped to the account and token.

Each request snapshots the selected account once. Switching accounts affects the
next model call, including auxiliary calls; it does not replace credentials under
an in-flight response. Quota/auth failures cannot bench the adapter's non-secret
credential marker and disable the next selected account.

## Install and verify

Run these scripts with Hermes's Python dependencies and source available on
`sys.path` (for a source install, `scripts/run-in-hermes-env` supplies that
environment):

```text
python install.py --profile-home <Hermes profile directory>
python test_provider.py
python verify.py
python verify.py --live
```

`install.py` changes only the chosen profile's model routing and adds a non-secret
`dobius` pool marker. It retains all other provider grants. It saves the old YAML,
old adapter marker and any earlier plugin under that profile's `backups/`.
Restore the saved YAML to return to the old provider; the unused plugin/marker
can remain installed. Tests use synthetic grants. `verify.py --live` performs
two small inference requests in a temporary profile, including a real Hermes
agent turn, without importing the user's memory or tools.

Installation does not restart running TUI/gateway sessions or rewrite models
already saved in old conversations. Start a new conversation after restarting,
or choose `codex/auto` with provider `dobius` in the model picker.

## Runtime locations and SSH

Codex resolution: `dobius.codex_home` in Hermes YAML, then
`DOBIUS_CODEX_HOME`, then `CODEX_HOME`, then Dobius's platform-specific
`codex-runtime-home/home`. A missing login fails rather than silently borrowing
an unrelated `~/.codex` login. Dobius-selected API-key accounts use the public
OpenAI Responses endpoint; subscription accounts use the Codex endpoint.

Claude resolution: `dobius.claude_config_dir`, then `CLAUDE_CONFIG_DIR`, then
the Claude CLI runtime directory/Keychain. Claude tokens must be refreshed by
their owning CLI/Dobius. Codex expiry asks the official CLI to refresh its own
authoritative home; the plugin never rotates a copied refresh grant.

On SSH/WSL, install the plugin in the Hermes profile on that host and supply the
remote runtime home there. No local credentials are forwarded to another host.
Use `DOBIUS_USER_DATA_DIR` for an alternate Dobius data root and
`DOBIUS_CODEX_BIN` for an explicitly selected Codex binary.

## Current limits

Codex/ChatGPT inference and a complete Hermes turn are live-verified. Claude's
account reader and the provider codecs have synthetic coverage; Claude and other
providers still need live verification with the intended account. Other provider
routes use their existing Hermes credentials, not arbitrary Dobius account stores.
Bedrock and external-process/ACP transports need dedicated adapters.

Responses are buffered before the adapter emits Hermes-compatible stream chunks,
as in Hermes's ACP client; incremental token display is not yet implemented.
Hermes still executes structured tool calls itself. Account changes can occur
between tool iterations; native encrypted reasoning is not replayed across them.
