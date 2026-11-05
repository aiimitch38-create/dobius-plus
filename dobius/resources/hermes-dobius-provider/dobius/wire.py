"""Native conversions are owned by Hermes, including tool name and replay rules."""

import time
from copy import copy
import uuid
from types import SimpleNamespace


def completion(message, finish_reason, model, usage):
    return SimpleNamespace(
        id="dobius-" + uuid.uuid4().hex, object="chat.completion", created=int(time.time()), model=model,
        choices=[SimpleNamespace(index=0, message=message, finish_reason=finish_reason)], usage=usage,
    )


def usage_counts(raw, *, anthropic=False):
    source = getattr(raw, "usage", None)
    prompt = getattr(source, "input_tokens", 0) or 0
    output = getattr(source, "output_tokens", 0) or 0
    cached = getattr(source, "cache_read_input_tokens", 0) if anthropic else getattr(getattr(source, "input_tokens_details", None), "cached_tokens", 0)
    return SimpleNamespace(prompt_tokens=prompt, completion_tokens=output, total_tokens=prompt + output,
                           prompt_tokens_details=SimpleNamespace(cached_tokens=cached or 0))


def reasoning(kwargs):
    effort = kwargs.get("reasoning_effort")
    return {"effort": effort, "enabled": effort != "none"} if effort else None


def call_responses(client, account, model, messages, tools, kwargs):
    from agent.transports.codex import ResponsesApiTransport
    transport = ResponsesApiTransport()
    tool_choice = kwargs.get("tool_choice")
    if isinstance(tool_choice, dict) and tool_choice.get("type") == "function":
        tool_choice = {"type": "function", "name": tool_choice["function"]["name"]}
    native = transport.build_kwargs(
        model, messages, tools, base_url=account.base_url, provider=account.provider,
        is_codex_backend=account.provider == "openai-codex",
        reasoning_config=reasoning(kwargs), max_tokens=kwargs.get("max_completion_tokens") or kwargs.get("max_tokens"),
        replay_encrypted_reasoning=False,
        request_overrides={"tool_choice": tool_choice} if tool_choice else None,
    )
    # Codex subscription responses are SSE-only. Consume a completed response, never an arbitrary partial.
    final = None
    output_items = {}
    with client.responses.create(**native, stream=True) as events:
        for event in events:
            if event.type == "response.output_item.done":
                output_items[event.output_index] = event.item
            if event.type in ("response.completed", "response.incomplete", "response.failed"):
                final = event.response
    if final is None:
        raise RuntimeError("Dobius's model stream ended before a final response.")
    if getattr(final, "status", "completed") != "completed":
        raise RuntimeError("The selected model did not complete its response; retry the turn.")
    # Codex can leave the terminal envelope empty after sending completed output items.
    # Preserve those typed items (including tool calls), never partial text or reasoning deltas.
    if not getattr(final, "output", None) and output_items:
        output = [output_items[index] for index in sorted(output_items)]
        if hasattr(final, "model_copy"):
            final = final.model_copy(update={"output": output})
        else:
            final = copy(final)
            final.output = output
    message = transport.normalize_response(final)
    finish = message.finish_reason
    # A generic chat client has no native Responses continuation channel.
    if finish == "incomplete":
        raise RuntimeError("The selected model returned an incomplete response; retry the turn.")
    return completion(message, finish, model, usage_counts(final))


def call_anthropic(client, account, model, messages, tools, kwargs):
    from agent.anthropic_credentials import _is_oauth_token
    from agent.transports.anthropic import AnthropicTransport
    transport = AnthropicTransport()
    oauth = _is_oauth_token(account.token)
    native = transport.build_kwargs(
        model, messages, tools, base_url=account.base_url, is_oauth=oauth,
        max_tokens=kwargs.get("max_completion_tokens") or kwargs.get("max_tokens") or 8192,
        tool_choice=kwargs.get("tool_choice"), reasoning_config=reasoning(kwargs), drop_context_1m_beta=True,
    )
    response = client.messages.create(**native)
    normalized = transport.normalize_response(response, strip_tool_prefix=oauth)
    return completion(normalized, normalized.finish_reason, model, usage_counts(response, anthropic=True))
