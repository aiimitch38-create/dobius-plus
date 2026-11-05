"""OpenAI-shaped client; native Hermes codecs preserve structured tool calls."""

import threading
from types import SimpleNamespace

from .accounts import Account, read_claude, read_codex
from .catalog import candidates, model_rejected, remember
from .errors import account_failure
from .wire import call_anthropic, call_responses


class DobiusClient:
    def __init__(self, **kwargs):
        self.api_key = "dobius-selected-account"
        self.base_url = "http://127.0.0.1:1/dobius"
        self.is_closed = False
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))
        self._clients = set()
        self._lock = threading.Lock()

    def close(self):
        with self._lock:
            self.is_closed = True
            clients = tuple(self._clients)
        for client in clients:
            client.close()

    def _route(self, model):
        provider, slash, requested = model.partition("/")
        if not slash or not requested or provider in ("dobius", "auto"):
            raise ValueError("Choose codex/auto, claude/auto, or provider/model with the Dobius provider.")
        if provider == "codex":
            return read_codex(), requested, "codex_responses"
        if provider == "claude":
            return read_claude(), requested, "anthropic_messages"
        # API providers remain swappable; their own Hermes resolver owns authentication.
        from hermes_cli.runtime_provider import resolve_runtime_provider
        runtime = resolve_runtime_provider(requested=provider, target_model=requested)
        mode = runtime.get("api_mode", "chat_completions")
        if runtime.get("provider") == "dobius" or mode not in ("chat_completions", "codex_responses", "anthropic_messages"):
            raise ValueError("This provider needs a dedicated Dobius inference adapter.")
        return Account(runtime["provider"], runtime["base_url"], runtime["api_key"]), requested, mode

    def create(self, *, model, messages, tools=None, stream=False, **kwargs):
        if self.is_closed:
            raise RuntimeError("Dobius inference client is closed.")
        # Snapshot once per call: switching accounts cannot mix headers and token mid-request.
        account, requested, mode = self._route(model)
        if mode == "anthropic_messages":
            from agent.anthropic_adapter import build_anthropic_client
            client = build_anthropic_client(account.token, account.base_url, drop_context_1m_beta=True)
        else:
            from openai import OpenAI
            headers = {}
            if account.provider == "openai-codex":
                from agent.codex_headers import codex_cloudflare_headers
                headers = codex_cloudflare_headers(account.token)
                if account.account_id:
                    headers["ChatGPT-Account-ID"] = account.account_id
            client = OpenAI(api_key=account.token, base_url=account.base_url,
                            default_headers=headers, max_retries=0, timeout=kwargs.get("timeout") or 180)
        with self._lock:
            if self.is_closed:
                client.close()
                raise RuntimeError("Dobius inference client is closed.")
            self._clients.add(client)
        try:
            models = candidates(account, requested, client)
            for index, selected in enumerate(models):
                try:
                    if mode == "codex_responses":
                        result = call_responses(client, account, selected, messages, tools, kwargs)
                    elif mode == "anthropic_messages":
                        result = call_anthropic(client, account, selected, messages, tools, kwargs)
                    else:
                        result = client.chat.completions.create(model=selected, messages=messages, tools=tools, **kwargs)
                    if requested == "auto":
                        remember(account, selected, accepted=True)
                    break
                except Exception as error:
                    if requested == "auto" and model_rejected(error):
                        remember(account, selected, accepted=False)
                    if requested != "auto" or index == len(models) - 1 or not model_rejected(error):
                        raise
            if stream:
                # Same buffered streaming contract as Hermes's ACP adapter; no tool-call parsing from prose.
                from agent.acp_openai_bridge import completion_to_stream_chunks
                return completion_to_stream_chunks(result)
            return result
        except Exception as error:
            failure = account_failure(error)
            if failure:
                raise failure from None
            raise
        finally:
            with self._lock:
                self._clients.discard(client)
            client.close()
