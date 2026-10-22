"""Synthetic Hermes modules: tests never import a private profile or provider."""

import asyncio
from dataclasses import dataclass
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch


def fake_modules():
    registry = SimpleNamespace(entries={})
    policy = SimpleNamespace(name="no-tools", allowed_tool_names=frozenset())
    state = SimpleNamespace(locked=False, pid=False, busy=False, policy=policy,
                            constructed=[], databases=[], interrupts=[], provider_failed=False,
                            fast_evict=False, constructor_failed=False)

    class Platform:
        def __init__(self, value):
            self.value = value

        def __hash__(self):
            return hash(self.value)

        def __eq__(self, other):
            return self.value == getattr(other, "value", None)

    class PlatformConfig:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class BasePlatformAdapter:
        def __init__(self, config, platform):
            self.config = config
            self.platform = platform

        def set_message_handler(self, fn):
            self._message_handler = fn

        def set_session_store(self, store):
            self._session_store = store

        def build_source(self, **kwargs):
            return SimpleNamespace(platform=self.platform, **kwargs)

    @dataclass
    class MessageEvent:
        text: str
        source: object
        message_type: str
        message_id: str
        internal: bool

        def is_command(self):
            return self.text.startswith("/")

    class PluginContext:
        def __init__(self, manifest, manager):
            self.manifest = manifest
            self.manager = manager

        def register_platform(self, **kwargs):
            registry.entries[kwargs["name"]] = SimpleNamespace(**kwargs)

    class SessionDB:
        def __init__(self, db_path=None):
            self.path = Path(db_path)
            self.closed = False
            state.databases.append(self)

        def close(self):
            self.closed = True

    def session_key(source, **_):
        return f"{source.platform.value}:{source.chat_id}:{source.user_id}"

    class GatewayRunner:
        def __init__(self, config, *, session_db=None, perform_maintenance=True):
            if state.constructor_failed:
                raise ValueError("synthetic initialization failure")
            if perform_maintenance or session_db is None:
                raise AssertionError("profile default DB/maintenance must never run")
            self.config = config
            self._session_db = session_db
            self.session_store = SimpleNamespace()
            self.delivery_router = SimpleNamespace()
            self._running_agents = {}
            self._agent_cache = {}
            state.constructed.append(self)

        def _get_proxy_url(self):
            return "https://unrestricted-remote.invalid"

        def _create_adapter(self, platform, config):
            return registry.entries[platform.value].adapter_factory(config)

        async def _handle_message(self, event):
            assert not event.is_command()
            assert not event.internal
            assert self._get_proxy_url() is None
            key = session_key(event.source)
            agent = SimpleNamespace(host_tool_policy=state.policy,
                                    interrupt=lambda: state.interrupts.append(key))
            self._agent_cache[key] = (agent, "signature")
            self._running_agents[key] = agent
            result = await self._run_agent(session_key=key)
            self._running_agents.pop(key, None)
            if state.fast_evict:
                self._agent_cache.pop(key, None)
            return result["final_response"]

        async def _run_agent(self, **_):
            if not state.fast_evict:
                await asyncio.sleep(0.04)
            return {"final_response": "Proposed reply", "failed": state.provider_failed}

        async def start(self):
            raise AssertionError("global gateway lifecycle must not run")

        async def stop(self):
            raise AssertionError("global cleanup must not run")

    def acquire():
        state.locked = not state.busy
        return state.locked

    def require(_platform, wanted):
        if state.policy != wanted:
            raise ValueError("policy mismatch")

    values = {
        "gateway": {},
        "gateway.config": {"Platform": Platform, "PlatformConfig": PlatformConfig,
                           "SessionResetPolicy": lambda **kw: SimpleNamespace(**kw),
                           "load_gateway_config": lambda: SimpleNamespace(streaming=SimpleNamespace())},
        "gateway.platforms": {},
        "gateway.platforms.base": {"BasePlatformAdapter": BasePlatformAdapter,
                                   "MessageEvent": MessageEvent,
                                   "MessageType": SimpleNamespace(TEXT="text"),
                                   "SendResult": lambda **kw: SimpleNamespace(**kw)},
        "gateway.platform_registry": {"platform_registry": SimpleNamespace(get=registry.entries.get)},
        "gateway.status": {"acquire_gateway_runtime_lock": acquire,
                           "get_running_pid": lambda: 123 if state.busy else None,
                           "write_pid_file": lambda: setattr(state, "pid", True),
                           "release_gateway_runtime_lock": lambda: setattr(state, "locked", False),
                           "remove_pid_file": lambda: setattr(state, "pid", False)},
        "gateway.run": {"GatewayRunner": GatewayRunner},
        "gateway.session": {"build_session_key": session_key},
        "hermes_cli": {},
        "hermes_cli.plugins": {"PluginContext": PluginContext,
                               "PluginManifest": lambda **kw: SimpleNamespace(**kw)},
        "hermes_state": {"SessionDB": SessionDB},
        "agent": {},
        "agent.host_tool_policy": {"NO_TOOLS_POLICY": policy,
                                   "require_platform_tool_policy": require,
                                   "policy_for_platform": lambda _: state.policy},
    }
    modules = {}
    for name, attributes in values.items():
        module = ModuleType(name)
        module.__dict__.update(attributes)
        modules[name] = module
    return state, modules


class FakeHermes:
    def __enter__(self):
        self.state, modules = fake_modules()
        self.previous_adapter = sys.modules.pop("platform_adapter", None)
        self.patch = patch.dict(sys.modules, modules)
        self.patch.start()
        return self.state

    def __exit__(self, *args):
        sys.modules.pop("platform_adapter", None)
        if self.previous_adapter is not None:
            sys.modules["platform_adapter"] = self.previous_adapter
        self.patch.stop()
