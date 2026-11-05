"""Ask Codex to refresh its own authoritative store; never copy refresh tokens."""

import json
import os
import shutil
import subprocess
import threading

_lock = threading.Lock()


def refresh_codex(home):
    binary = os.environ.get("DOBIUS_CODEX_BIN") or shutil.which("codex")
    if not binary:
        raise RuntimeError("Open the selected Codex account in Dobius to refresh its login.")
    requests = [
        {"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "dobius-hermes", "version": "1.0.0"}}},
        {"method": "initialized", "params": {}},
        {"id": 2, "method": "account/read", "params": {"refreshToken": True}},
    ]
    # No shell or token arguments. The official CLI owns refresh and file persistence.
    with _lock:
        try:
            subprocess.run(
                [binary, "app-server"], input="".join(json.dumps(r) + "\n" for r in requests),
                text=True, encoding="utf-8", capture_output=True, timeout=25, check=True,
                env={**os.environ, "CODEX_HOME": str(home)},
            )
        except (OSError, subprocess.SubprocessError):
            raise RuntimeError("Could not refresh the selected Dobius Codex login; sign in again in Dobius.") from None
