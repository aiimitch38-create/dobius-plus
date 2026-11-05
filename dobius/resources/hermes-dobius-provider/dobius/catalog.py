"""Catalog state is scoped to a principal, never to a client or global model."""

import hashlib
import threading
import time

_cache = {}
_working = {}
_rejected = {}
_lock = threading.Lock()


def cache_key(account):
    # Include token fingerprint: renewed entitlements invalidate both catalog and rejection hints.
    return account.provider, account.base_url, account.account_id, hashlib.sha256(account.token.encode()).hexdigest()


def candidates(account, requested, client):
    if requested != "auto":
        return [requested]
    key = cache_key(account)
    with _lock:
        cached = _cache.get(key)
    if cached and cached[0] > time.monotonic():
        models = cached[1]
    else:
        if account.provider == "openai-codex":
            from hermes_cli.codex_models import _fetch_models_from_api
            models = _fetch_models_from_api(account.token, account.base_url)
        else:
            models = [item.id for item in client.models.list()]
        if models:
            with _lock:
                _cache[key] = time.monotonic() + 60, models
    with _lock:
        working = _working.get(key)
        denied = _rejected.get(key, {})
        successful = working[1] if working and working[0] > time.monotonic() else ""
        rejected = {m for m, until in denied.items() if until > time.monotonic()}
    ordered = [successful, account.preferred_model, *(models or [])]
    ordered = list(dict.fromkeys(m for m in ordered if m and m not in rejected))
    if not ordered:
        raise RuntimeError("The selected account supplied no model catalog; choose an explicit provider/model in Hermes.")
    return ordered


def remember(account, model, *, accepted):
    key = cache_key(account)
    with _lock:
        if accepted:
            _working[key] = time.monotonic() + 60, model
        else:
            _rejected.setdefault(key, {})[model] = time.monotonic() + 60


def model_rejected(error):
    # Retry only model selection failures, never quota, authentication, or a broken prompt.
    if getattr(error, "status_code", None) not in (400, 403, 404):
        return False
    body = getattr(error, "body", {}) or {}
    detail = body.get("error", body) if isinstance(body, dict) else {}
    code = detail.get("code") if isinstance(detail, dict) else ""
    message = str(error).lower()
    return code in ("model_not_found", "model_not_supported", "unsupported_model") or (
        "model" in message and ("not supported when using codex" in message or "not entitled" in message)
    )
