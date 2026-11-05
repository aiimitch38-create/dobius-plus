"""Exercise real discovery in an isolated profile; optional tiny live inference."""

import argparse
import importlib.util
import json
import os
import tempfile
from pathlib import Path


def verify(live=False, account_home=None):
    # Bootstrap before binding the scratch profile; it borrows the installed runtime.
    import hermes_bootstrap
    source = Path(__file__).parent
    spec = importlib.util.spec_from_file_location("dobius_provider_installer", source / "install.py")
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    with tempfile.TemporaryDirectory(prefix="dobius-provider-verify-") as directory:
        home = Path(directory)
        os.environ["HERMES_HOME"] = directory
        import hermes_yaml as yaml
        config = {"model": {"provider": "openai-codex", "default": "original"}, "agent": {"max_turns": 3}}
        if account_home:
            config["dobius"] = {"codex_home": str(account_home.expanduser().resolve())}
        (home / "config.yaml").write_text(yaml.safe_dump(config), encoding="utf-8")
        (home / "auth.json").write_text(json.dumps({"version": 1, "credential_pool": {
            "untouched": [{"access_token": "synthetic-existing-grant"}],
        }}), encoding="utf-8")
        installer.install(home)
        from providers import get_provider_profile
        profile = get_provider_profile("dobius")
        assert profile is not None, "Provider plugin was not discovered"
        from hermes_cli.runtime_provider import resolve_runtime_provider
        runtime = resolve_runtime_provider(requested="dobius", target_model="codex/auto")
        assert runtime["provider"] == "dobius", runtime["provider"]
        assert runtime["api_key"] == "dobius-selected-account"
        assert runtime["api_mode"] == "chat_completions"
        auth = json.loads((home / "auth.json").read_text())
        assert auth["credential_pool"]["untouched"][0]["access_token"] == "synthetic-existing-grant"
        assert not any("refresh_token" in row for row in auth["credential_pool"]["dobius"])
        client = profile.create_client(**runtime)
        assert client.__class__.__name__ == "DobiusClient"
        print("PASS: isolated install, real provider discovery, credential resolution, existing grant preservation", flush=True)
        if live:
            result = client.chat.completions.create(
                model="codex/auto", messages=[{"role": "user", "content": "Reply with exactly DOBIUS_ADAPTER_OK."}],
            )
            print("Live model:", result.model)
            assert "DOBIUS_ADAPTER_OK" in (result.choices[0].message.content or "")
            print("PASS: live inference through selected Dobius account")
            from run_agent import AIAgent
            agent = AIAgent(
                model="codex/auto", provider="dobius", api_mode="chat_completions",
                api_key=runtime["api_key"], base_url=runtime["base_url"],
                enabled_toolsets=[], max_iterations=2, quiet_mode=True,
                skip_context_files=True, skip_memory=True, skip_background_review=True,
                cwd=directory, run_budget_seconds=60,
            )
            try:
                turn = agent.run_conversation("Reply with exactly DOBIUS_HERMES_LOOP_OK.")
                assert "DOBIUS_HERMES_LOOP_OK" in turn.get("final_response", ""), str(turn.get("failure_reason", "unknown failure"))
                print("PASS: complete Hermes agent turn through adapter", flush=True)
            finally:
                agent.close()
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--account-home", type=Path, help="Verify a specific runtime home without switching Dobius's selection")
    options = parser.parse_args()
    verify(options.live, options.account_home)
