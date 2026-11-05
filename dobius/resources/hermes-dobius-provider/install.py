"""Install into one explicitly chosen Hermes profile, retaining rollback copies."""

import argparse
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, staging = tempfile.mkstemp(prefix=".dobius-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(text)
        os.replace(staging, path)
    finally:
        if os.path.exists(staging):
            os.unlink(staging)


def install(profile_home):
    import hermes_yaml as yaml

    home = profile_home.expanduser().resolve()
    config_path = home / "config.yaml"
    if not config_path.is_file():
        raise RuntimeError("Choose an existing Hermes profile with config.yaml.")
    config_text = config_path.read_text(encoding="utf-8")
    config = yaml.safe_load(config_text)
    if not isinstance(config, dict) or not isinstance(config.get("model"), dict):
        raise RuntimeError("The profile needs a valid model configuration.")
    os.environ["HERMES_HOME"] = str(home)
    from hermes_cli.auth import _auth_store_lock, _load_auth_store, _save_auth_store

    source = Path(__file__).parent / "dobius"
    destination = home / "plugins" / "model-providers" / "dobius"
    backup = home / "backups" / ("dobius-provider-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    backup.mkdir(parents=True, mode=0o700)
    atomic_write(backup / "config.yaml", config_text)
    if destination.exists():
        shutil.copytree(destination, backup / "plugin", ignore=shutil.ignore_patterns("__pycache__"))
    # Stage before changing auth or config, so a failed copy leaves the old profile usable.
    staged = backup / "staged-plugin"
    shutil.copytree(source, staged, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.rename(backup / "previous-plugin")
    staged.rename(destination)
    with _auth_store_lock():
        auth = _load_auth_store()
        # Hermes sees only a non-secret marker, never a copied provider grant.
        pool = auth.setdefault("credential_pool", {})
        previous = pool.get("dobius")
        import json
        atomic_write(backup / "dobius-pool.json", json.dumps(previous))
        pool["dobius"] = [{
            "id": "dobius-runtime", "label": "Dobius selected account", "auth_type": "api_key",
            "source": "manual:api_key", "priority": 0,
            "access_token": "dobius-selected-account", "last_status": "ok",
            "base_url": "http://127.0.0.1:1/dobius",
        }]
        _save_auth_store(auth)
    config["model"].update({"provider": "dobius", "default": "codex/auto", "base_url": "", "api_mode": "chat_completions"})
    # Core Codex execution must not replace Hermes's own tool loop for this provider.
    config["model"].pop("openai_runtime", None)
    atomic_write(config_path, yaml.safe_dump(config, sort_keys=False, allow_unicode=True))
    print(f"Installed Dobius inference provider in {home}")
    print(f"Rollback configuration: {backup / 'config.yaml'}")
    print("Restart this Hermes profile. Model: codex/auto; provider: dobius.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-home", type=Path, required=True)
    options = parser.parse_args()
    install(options.profile_home)
