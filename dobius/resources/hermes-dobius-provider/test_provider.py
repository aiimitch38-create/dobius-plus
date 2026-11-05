"""Synthetic credentials only; no live providers or private profile imports."""

import base64
import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).parent
# Load submodules without registering a provider into the test process's global registry.
package = ModuleType("dobius")
package.__path__ = [str(ROOT / "dobius")]
sys.modules["dobius"] = package
from dobius.accounts import Account, codex_home, read_codex, read_claude
from dobius.catalog import cache_key, candidates, model_rejected, remember
from dobius.client import DobiusClient


def token(account, expires=None):
    payload = {"exp": expires or time.time() + 3600,
               "https://api.openai.com/auth": {"chatgpt_account_id": account}}
    return "test." + base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=") + ".test"


def write_auth(home, account):
    home.mkdir(parents=True, exist_ok=True)
    (home / "auth.json").write_text(json.dumps({"tokens": {"access_token": token(account), "account_id": account}}))


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_same_client_reads_new_account_for_next_request(self):
        home = self.root / "runtime"
        write_auth(home, "account-one")
        client = DobiusClient()
        captured = []
        def route(model):
            return read_codex({"codex_home": str(home)}), "explicit-model", "codex_responses"
        def call(sdk, account, model, messages, tools, kwargs):
            captured.append((account.account_id, account.token))
            return SimpleNamespace(choices=[])
        with patch.object(client, "_route", side_effect=route), patch("openai.OpenAI"), patch("dobius.client.call_responses", side_effect=call):
            client.create(model="codex/explicit-model", messages=[])
            write_auth(home, "account-two")
            client.create(model="codex/explicit-model", messages=[])
        self.assertEqual([a for a, _ in captured], ["account-one", "account-two"])
        self.assertNotEqual(captured[0][1], captured[1][1])

    def test_missing_runtime_fails_instead_of_borrowing_another_login(self):
        with self.assertRaisesRegex(RuntimeError, "runtime login is unavailable"):
            read_codex({"codex_home": str(self.root / "missing")})

    def test_snapshot_survives_account_switch(self):
        write_auth(self.root, "one")
        snapshot = read_codex({"codex_home": str(self.root)})
        write_auth(self.root, "two")
        self.assertEqual(snapshot.account_id, "one")
        self.assertEqual(read_codex({"codex_home": str(self.root)}).account_id, "two")
        self.assertNotIn(snapshot.token, repr(snapshot))

    def test_api_key_account_uses_public_api(self):
        (self.root / "auth.json").write_text(json.dumps({"auth_mode": "apikey", "OPENAI_API_KEY": "synthetic-api-key"}))
        account = read_codex({"codex_home": str(self.root)})
        self.assertEqual(account.provider, "openai")
        self.assertEqual(account.base_url, "https://api.openai.com/v1")

    def test_expired_login_asks_owning_cli_to_refresh(self):
        (self.root / "auth.json").write_text(json.dumps({"tokens": {"access_token": token("one", time.time() - 10)}}))
        with patch("dobius.refresh.refresh_codex", side_effect=lambda home: write_auth(home, "fresh")) as refresh:
            self.assertEqual(read_codex({"codex_home": str(self.root)}).account_id, "fresh")
            refresh.assert_called_once_with(self.root)

    def test_claude_reads_selected_runtime_without_persisting_tokens(self):
        credentials = self.root / ".credentials.json"
        credentials.write_text(json.dumps({"claudeAiOauth": {"accessToken": "synthetic-claude-one"}}))
        self.assertEqual(read_claude({"claude_config_dir": str(self.root)}).token, "synthetic-claude-one")
        credentials.write_text(json.dumps({"claudeAiOauth": {"accessToken": "synthetic-claude-two"}}))
        self.assertEqual(read_claude({"claude_config_dir": str(self.root)}).token, "synthetic-claude-two")

    def test_inherited_ssh_runtime_home_is_respected(self):
        with patch.dict(os.environ, {"DOBIUS_CODEX_HOME": "/remote/selected"}):
            self.assertEqual(codex_home({}), Path("/remote/selected"))
            self.assertEqual(codex_home({"codex_home": "/explicit"}), Path("/explicit"))


class RoutingTests(unittest.TestCase):
    def test_catalog_and_rejections_cannot_bleed_between_accounts(self):
        one = Account("openai-codex", "https://chatgpt.com/backend-api/codex", "token-one", "one")
        two = Account("openai-codex", "https://chatgpt.com/backend-api/codex", "token-two", "two")
        self.assertNotEqual(cache_key(one), cache_key(two))
        remember(one, "preferred", accepted=False)
        with patch("hermes_cli.codex_models._fetch_models_from_api", return_value=["preferred", "available"]):
            self.assertEqual(candidates(one, "auto", None), ["available"])
            self.assertEqual(candidates(two, "auto", None), ["preferred", "available"])

    def test_pinned_models_never_fall_back(self):
        client = DobiusClient()
        error = RuntimeError("unsupported")
        error.status_code, error.body = 400, {"error": {"code": "model_not_found"}}
        account = Account("openai-codex", "https://chatgpt.com/backend-api/codex", "fake")
        with patch.object(client, "_route", return_value=(account, "pinned", "codex_responses")), patch("openai.OpenAI"), patch("dobius.client.call_responses", side_effect=error) as call:
            with self.assertRaises(RuntimeError):
                client.create(model="codex/pinned", messages=[])
            self.assertEqual(call.call_count, 1)

    def test_auto_falls_back_only_for_entitlement(self):
        client = DobiusClient()
        account = Account("openai-codex", "https://chatgpt.com/backend-api/codex", "fake")
        error = RuntimeError("model unavailable")
        error.status_code, error.body = 400, {"error": {"code": "model_not_found"}}
        result = SimpleNamespace(choices=[])
        with patch.object(client, "_route", return_value=(account, "auto", "codex_responses")), patch("openai.OpenAI"), patch("dobius.client.candidates", return_value=["denied", "available"]), patch("dobius.client.call_responses", side_effect=[error, result]) as call:
            self.assertIs(client.create(model="codex/auto", messages=[]), result)
            self.assertEqual(call.call_count, 2)
        error.status_code = 429
        self.assertFalse(model_rejected(error))
        error.status_code = 401
        self.assertFalse(model_rejected(error))

    def test_closed_client_cannot_issue_another_request(self):
        client = DobiusClient()
        client.close()
        with self.assertRaisesRegex(RuntimeError, "closed"):
            client.create(model="codex/auto", messages=[])

    def test_account_failure_cannot_bench_adapter_for_next_account(self):
        from dobius.errors import account_failure, classify
        error = RuntimeError("synthetic upstream 429")
        error.status_code = 429
        wrapped = account_failure(error)
        self.assertNotIn("429", str(wrapped))
        self.assertIsNone(getattr(wrapped, "status_code", None))
        verdict = classify(wrapped)
        self.assertFalse(verdict["should_rotate_credential"])
        self.assertFalse(verdict["should_fallback"])

    def test_real_hermes_codec_preserves_structured_tools(self):
        from dobius.wire import call_responses
        sdk = MagicMock()
        final = SimpleNamespace(status="completed", output=[SimpleNamespace(
            type="function_call", id="fc_test", call_id="call_test", name="lookup", arguments='{"query":"hello"}', status="completed",
        )], usage=SimpleNamespace(input_tokens=10, output_tokens=5))
        sdk.responses.create.return_value.__enter__.return_value = [SimpleNamespace(type="response.completed", response=final)]
        account = Account("openai-codex", "https://chatgpt.com/backend-api/codex", "fake")
        response = call_responses(sdk, account, "synthetic-model", [{"role": "user", "content": "hello"}], [{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object", "properties": {}}}}], {"tool_choice": "required"})
        self.assertEqual(response.choices[0].finish_reason, "tool_calls")
        self.assertEqual(response.choices[0].message.tool_calls[0].function.name, "lookup")
        self.assertEqual(response.usage.total_tokens, 15)
        self.assertEqual(sdk.responses.create.call_args.kwargs["tool_choice"], "required")

    def test_codex_completed_envelope_can_omit_previously_completed_output_items(self):
        from dobius.wire import call_responses
        sdk = MagicMock()
        item = SimpleNamespace(type="message", id="msg_done", role="assistant", status="completed",
                               content=[SimpleNamespace(type="output_text", text="ADAM_VOICE_CONNECTED", annotations=[])])
        final = SimpleNamespace(status="completed", output=[], usage=None)
        sdk.responses.create.return_value.__enter__.return_value = [
            SimpleNamespace(type="response.output_item.done", output_index=0, item=item),
            SimpleNamespace(type="response.completed", response=final),
        ]
        account = Account("openai-codex", "https://chatgpt.com/backend-api/codex", "fake")
        response = call_responses(sdk, account, "synthetic-model", [{"role": "user", "content": "hello"}], None, {})
        self.assertEqual(response.choices[0].message.content, "ADAM_VOICE_CONNECTED")
        self.assertEqual(final.output, [])

    def test_incomplete_or_failed_stream_is_never_accepted_as_a_completed_answer(self):
        from dobius.wire import call_responses
        account = Account("openai-codex", "https://chatgpt.com/backend-api/codex", "fake")
        for status in ("failed", "incomplete"):
            sdk = MagicMock()
            sdk.responses.create.return_value.__enter__.return_value = [
                SimpleNamespace(type="response.output_item.done", output_index=0, item=SimpleNamespace(type="message")),
                SimpleNamespace(type="response." + status, response=SimpleNamespace(status=status, output=[])),
            ]
            with self.assertRaisesRegex(RuntimeError, "did not complete"):
                call_responses(sdk, account, "synthetic-model", [], None, {})


if __name__ == "__main__":
    unittest.main()
