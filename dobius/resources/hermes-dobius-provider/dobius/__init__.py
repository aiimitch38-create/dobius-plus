"""Dobius accounts are interchangeable inference backends for Hermes."""

from providers import register_provider
from providers.base import ProviderProfile

from .client import DobiusClient
from .errors import classify


class DobiusProfile(ProviderProfile):
    def create_client(self, **kwargs):
        return DobiusClient(**kwargs)

    def fetch_models(self, **kwargs):
        # These are routes, not promises of entitlement to a particular model.
        return ["codex/auto", "claude/auto"]


register_provider(DobiusProfile(
    name="dobius",
    display_name="Dobius accounts",
    description="Use Dobius's selected account; keep Hermes tools and memory",
    api_mode="chat_completions",
    auth_type="api_key",
    env_vars=("DOBIUS_PROVIDER_MARKER",),
    classify_api_error=classify,
    # The installer registers a non-secret marker; real credentials stay in Dobius.
    base_url="http://127.0.0.1:1/dobius",
    supports_health_check=False,
    supports_model_listing=False,
    supports_vision=True,
    fallback_models=("codex/auto", "claude/auto"),
    default_aux_model="",
    model_capabilities={name: {
        "supports_tools": True, "supports_vision": True,
        "context_window": 128000,
    } for name in ("codex/auto", "claude/auto")},
))
