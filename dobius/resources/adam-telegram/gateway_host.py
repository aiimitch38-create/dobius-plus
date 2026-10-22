"""One Adam-profile GatewayRunner, with a deliberately scoped lifecycle."""

import asyncio
from collections import OrderedDict
from pathlib import Path
import os
from types import SimpleNamespace

from bridge_protocol import PLATFORM, ProtocolError


def verify_policy():
    try:
        from agent.host_tool_policy import (NO_TOOLS_POLICY, policy_for_platform,
                                            require_platform_tool_policy)
        from gateway.platform_registry import platform_registry
        require_platform_tool_policy(PLATFORM, NO_TOOLS_POLICY)
        entry = platform_registry.get(PLATFORM)
        if entry is None or entry.tool_execution_policy != "no-tools":
            raise ProtocolError("policy-unavailable")
        if NO_TOOLS_POLICY.name != "no-tools" or NO_TOOLS_POLICY.allowed_tool_names != frozenset():
            raise ProtocolError("policy-unavailable")
        if policy_for_platform(PLATFORM) != NO_TOOLS_POLICY:
            raise ProtocolError("policy-unavailable")
    except Exception:
        raise ProtocolError("policy-unavailable") from None


class GatewayHost:
    def __init__(self, profile_home, *, verify_runtime):
        self.profile_home = Path(profile_home)
        self.verify_runtime = verify_runtime
        self.runner = None
        self.adapter = None
        self.turns = {}
        self.locked = False
        self.pid_written = False

    async def start(self):
        try:
            await self._start()
        except BaseException:
            await self.close()
            raise

    async def _start(self):
        self.verify_runtime()
        from hermes_cli.plugins import PluginContext, PluginManifest
        from platform_adapter import register
        try:
            register(PluginContext(PluginManifest(name=PLATFORM, kind="platform"),
                                   SimpleNamespace(_plugin_platform_names=set())))
        except (TypeError, ImportError, AttributeError):
            raise ProtocolError("policy-unavailable") from None
        verify_policy()
        from gateway.status import acquire_gateway_runtime_lock, get_running_pid, write_pid_file
        if get_running_pid() not in (None, os.getpid()):
            raise ProtocolError("gateway-busy")
        if not acquire_gateway_runtime_lock():
            raise ProtocolError("gateway-busy")
        self.locked = True
        try:
            write_pid_file()
            self.pid_written = True
        except Exception:
            raise ProtocolError("gateway-busy") from None
        from gateway.config import Platform, PlatformConfig, SessionResetPolicy, load_gateway_config
        from gateway.run import GatewayRunner

        class LocalGatewayRunner(GatewayRunner):
            def _get_proxy_url(self):
                # A remote API runner cannot attest this local host policy.
                return None

            async def _run_agent(self, *args, **kwargs):
                key = kwargs.get("session_key") or (args[5] if len(args) > 5 else None)
                try:
                    result = await super()._run_agent(*args, **kwargs)
                except BaseException:
                    self._bridge_failures.add(key)
                    raise
                if (not isinstance(result, dict) or result.get("failed")
                        or result.get("error") or result.get("interrupted")):
                    self._bridge_failures.add(key)
                return result

        platform = Platform(PLATFORM)
        config = load_gateway_config()
        config.platforms = {platform: PlatformConfig(enabled=True, extra={
            "group_sessions_per_user": True, "thread_sessions_per_user": True,
        })}
        bridge_home = self.profile_home / "dobius-telegram-bridge"
        bridge_home.mkdir(mode=0o700, exist_ok=True)
        from bridge_receipts import _private, prepare_private_file
        _private(bridge_home, directory=True)
        config.sessions_dir = bridge_home / "sessions"
        config.sessions_dir.mkdir(mode=0o700, exist_ok=True)
        _private(config.sessions_dir, directory=True)
        config.group_sessions_per_user = True
        config.thread_sessions_per_user = True
        config.streaming.enabled = False
        config.streaming.transport = "off"
        config.default_reset_policy = SessionResetPolicy(mode="none", notify=False)
        config.reset_by_type = {}
        config.reset_by_platform = {}
        config.quick_commands = {}
        config.reset_triggers = []
        from hermes_state import SessionDB
        database_path = bridge_home / "state.db"
        prepare_private_file(database_path)
        session_db = SessionDB(db_path=database_path)
        try:
            self.runner = LocalGatewayRunner(config, session_db=session_db, perform_maintenance=False)
        except Exception:
            session_db.close()
            raise
        self.runner._bridge_failures = set()
        owner = self

        class SessionAgentCache(OrderedDict):
            def __setitem__(self, key, value):
                agent = value[0]
                owner._assert_agent(agent)
                # Retain the exact initialized agent before a very fast
                # successful fallback can evict its ordinary gateway cache.
                for turn in list(owner.turns.values()):
                    if turn["session_key"] == key:
                        turn["agent"] = agent
                super().__setitem__(key, value)

        self.runner._agent_cache = SessionAgentCache(self.runner._agent_cache)
        adapter = self.runner._create_adapter(platform, config.platforms[platform])
        if adapter is None:
            raise ProtocolError("gateway-unavailable")
        self.adapter = adapter
        adapter.set_message_handler(self.runner._handle_message)
        adapter.set_session_store(self.runner.session_store)
        if not await adapter.connect():
            raise ProtocolError("gateway-unavailable")
        self.runner.adapters = {platform: adapter}
        self.runner.delivery_router.adapters = self.runner.adapters
        self.runner._gateway_loop = asyncio.get_running_loop()
        self.runner._running = True
        # Only this private pipe can originate this platform's events. Dobius
        # verifies account/chat/participant consent before sending any frame.
        os.environ["DOBIUS_ADAM_TELEGRAM_AUTHENTICATED_PIPE"] = "1"
        verify_policy()

    async def infer(self, request):
        self.verify_runtime()
        verify_policy()
        from gateway.session import build_session_key
        event = self.adapter.make_event(request)
        session_key = build_session_key(event.source, group_sessions_per_user=True,
                                        thread_sessions_per_user=True)
        state = {"session_key": session_key, "cancelled": False, "agent": None}
        cached = self.runner._agent_cache.get(session_key)
        if cached:
            self._assert_agent(cached[0])
            state["agent"] = cached[0]
        self.runner._bridge_failures.discard(session_key)
        self.turns[request["id"]] = state
        monitor = asyncio.create_task(self._monitor(state))
        try:
            result = await self.adapter.infer(event)
            self.verify_runtime()
            if state["cancelled"]:
                raise ProtocolError("cancelled")
            if session_key in self.runner._bridge_failures:
                raise ProtocolError("inference-failed")
            if state["agent"] is None:
                # A deterministic/fake provider may finish between monitor ticks.
                # The normal dispatcher retains the exact session's cached agent.
                cached = self.runner._agent_cache.get(session_key)
                state["agent"] = cached[0] if cached else None
            if state["agent"] is None:
                raise ProtocolError("policy-unavailable")
            self._assert_agent(state["agent"])
            return result
        finally:
            monitor.cancel()
            await asyncio.gather(monitor, return_exceptions=True)
            if self.turns.get(request["id"]) is state:
                self.turns.pop(request["id"])

    @staticmethod
    def _assert_agent(agent):
        policy = getattr(agent, "host_tool_policy", None)
        if (policy is None or policy.name != "no-tools"
                or policy.allowed_tool_names != frozenset()):
            raise ProtocolError("policy-unavailable")

    async def _monitor(self, state):
        while True:
            agent = self.runner._running_agents.get(state["session_key"])
            if agent is not None and callable(getattr(agent, "interrupt", None)):
                try:
                    self._assert_agent(agent)
                except ProtocolError:
                    state["cancelled"] = True
                    agent.interrupt()
                    return
                if state["agent"] is None:
                    state["agent"] = agent
                if state["cancelled"] and state["agent"] is agent:
                    agent.interrupt()
                    return
            await asyncio.sleep(0.025)

    def cancel(self, request):
        state = self.turns.get(request["id"])
        if state:
            state["cancelled"] = True
            agent = state["agent"]
            if agent is not None and self.runner._running_agents.get(state["session_key"]) is agent:
                agent.interrupt()

    async def close(self):
        if self.runner is None and self.adapter is None and not self.locked and not self.pid_written:
            return
        if self.runner:
            self.runner._running = False
            for state in self.turns.values():
                state["cancelled"] = True
                agent = state["agent"]
                if agent is not None:
                    agent.interrupt()
        if self.adapter:
            await self.adapter.disconnect()
        if self.turns:
            # The standalone runner exits immediately after closing its pipe.
            # Keep the profile lease until OS process exit when a provider
            # thread ignores interruption; never overlap another gateway.
            return
        if self.runner and self.runner._session_db is not None:
            self.runner._session_db.close()
            self.runner._session_db = None
        from gateway.status import release_gateway_runtime_lock, remove_pid_file
        if self.pid_written:
            remove_pid_file()
            self.pid_written = False
        if self.locked:
            release_gateway_runtime_lock()
            self.locked = False
