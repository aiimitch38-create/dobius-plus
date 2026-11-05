"""Read current runtime credentials, never import grants into Hermes's pool."""

import base64
import json
import os
import sys
import time
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Account:
    provider: str
    base_url: str
    token: str = field(repr=False)
    account_id: str = ""
    preferred_model: str = ""
    home: Path | None = None


def settings():
    from hermes_cli.config import load_config_readonly
    return (load_config_readonly() or {}).get("dobius", {})


def user_data_root():
    if root := os.environ.get("DOBIUS_USER_DATA_DIR"):
        return Path(root).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "dobius-plus"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "dobius-plus"
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "dobius-plus"


def codex_home(config=None):
    config = settings() if config is None else config
    explicit = config.get("codex_home") or os.environ.get("DOBIUS_CODEX_HOME") or os.environ.get("CODEX_HOME")
    if explicit:
        return Path(explicit).expanduser()
    # A missing Dobius login must not silently spend a different ~/.codex account.
    return user_data_root() / "codex-runtime-home" / "home"


def token_claims(token):
    try:
        encoded = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    except (ValueError, IndexError, TypeError):
        return {}


def read_codex(config=None):
    home = codex_home(config)
    try:
        auth = json.loads((home / "auth.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise RuntimeError("Select a signed-in Codex account in Dobius; its runtime login is unavailable.") from None
    tokens = auth.get("tokens") or {}
    token = tokens.get("access_token") or ""
    api_key = auth.get("OPENAI_API_KEY") or ""
    if not token and not api_key:
        raise RuntimeError("The selected Dobius Codex account is signed out.")
    if api_key and (auth.get("auth_mode") == "apikey" or not token):
        provider, base_url, token = "openai", "https://api.openai.com/v1", api_key
    else:
        provider, base_url = "openai-codex", "https://chatgpt.com/backend-api/codex"
    claims = token_claims(token)
    # Refresh remains the owning CLI's job: do not race its single-use refresh grant.
    if claims.get("exp", time.time() + 120) <= time.time() + 30:
        from .refresh import refresh_codex
        refresh_codex(home)
        fresh = json.loads((home / "auth.json").read_text(encoding="utf-8"))
        token = (fresh.get("tokens") or {}).get("access_token") or ""
        claims = token_claims(token)
        if not token or claims.get("exp", 0) <= time.time() + 30:
            raise RuntimeError("Refresh or sign in to the selected Codex account in Dobius.")
        tokens = fresh.get("tokens") or {}
    try:
        preferred = tomllib.loads((home / "config.toml").read_text(encoding="utf-8")).get("model", "")
    except (OSError, ValueError):
        preferred = ""
    identity = claims.get("https://api.openai.com/auth", {})
    return Account(provider, base_url, token,
                   tokens.get("account_id") or identity.get("chatgpt_account_id", ""),
                   preferred, home)


def read_claude(config=None):
    config = settings() if config is None else config
    root = Path(config.get("claude_config_dir") or os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude").expanduser()
    try:
        data = json.loads((root / ".credentials.json").read_text(encoding="utf-8"))
        record = data.get("claudeAiOauth") or {}
    except (OSError, ValueError):
        record = {}
    if not record and sys.platform == "darwin" and not config.get("claude_config_dir"):
        # Dobius materializes the selected Claude login into the CLI's runtime Keychain.
        from agent.anthropic_credentials import _read_claude_code_credentials_from_keychain
        record = _read_claude_code_credentials_from_keychain() or {}
    token = record.get("accessToken")
    if not token:
        raise RuntimeError("Select a signed-in Claude account in Dobius.")
    if record.get("expiresAt", (time.time() + 120) * 1000) <= (time.time() + 30) * 1000:
        raise RuntimeError("Refresh the selected Claude account in Dobius before using it in Hermes.")
    return Account("anthropic", "https://api.anthropic.com", token, home=root)
