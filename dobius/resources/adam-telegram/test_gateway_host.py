import asyncio
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from bridge_protocol import PLATFORM, ProtocolError
from gateway_fixture import FakeHermes
from gateway_host import GatewayHost, verify_policy
from test_bridge_protocol import request


class GatewayHostTests(unittest.IsolatedAsyncioTestCase):
    async def test_scoped_gateway_registration_profile_database_and_draft_only(self):
        with tempfile.TemporaryDirectory() as temporary, FakeHermes() as state:
            with patch.dict(os.environ):
                host = GatewayHost(Path(temporary), verify_runtime=lambda: None)
                await host.start()
                self.assertTrue(state.locked)
                self.assertTrue(state.pid)
                self.assertEqual(len(state.constructed), 1)
                self.assertEqual(state.databases[0].path,
                                 Path(temporary) / "dobius-telegram-bridge" / "state.db")
                config = state.constructed[0].config
                self.assertEqual([p.value for p in config.platforms], [PLATFORM])
                self.assertFalse(config.streaming.enabled)
                self.assertEqual(config.default_reset_policy.mode, "none")
                self.assertEqual(await host.infer(request(text="/restart")), "Proposed reply")
                result = await host.adapter.send("-100123", "not a final draft")
                self.assertFalse(result.success)
                await host.close()
                self.assertFalse(state.locked)
                self.assertFalse(state.pid)
                self.assertTrue(state.databases[0].closed)

    async def test_existing_gateway_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as temporary, FakeHermes() as state:
            state.busy = True
            host = GatewayHost(Path(temporary), verify_runtime=lambda: None)
            with self.assertRaises(ProtocolError) as raised:
                await host.start()
            self.assertEqual(raised.exception.code, "gateway-busy")
            self.assertEqual(state.constructed, [])
            await host.close()

    async def test_policy_failure_prevents_constructor_and_readiness(self):
        with tempfile.TemporaryDirectory() as temporary, FakeHermes() as state:
            state.policy = SimpleNamespace(name="unrestricted", allowed_tool_names=None)
            host = GatewayHost(Path(temporary), verify_runtime=lambda: None)
            with self.assertRaises(ProtocolError) as raised:
                await host.start()
            self.assertEqual(raised.exception.code, "policy-unavailable")
            self.assertEqual(state.constructed, [])

    async def test_exact_cancel_interrupts_only_its_running_agent(self):
        with tempfile.TemporaryDirectory() as temporary, FakeHermes() as state:
            with patch.dict(os.environ):
                host = GatewayHost(Path(temporary), verify_runtime=lambda: None)
                await host.start()
                first, second = request("first"), request("second", senderId="346")
                one = asyncio.create_task(host.infer(first))
                two = asyncio.create_task(host.infer(second))
                await asyncio.sleep(0.03)
                host.cancel(first)
                results = await asyncio.gather(one, two, return_exceptions=True)
                self.assertIsInstance(results[0], ProtocolError)
                self.assertEqual(results[0].code, "cancelled")
                self.assertEqual(results[1], "Proposed reply")
                self.assertTrue(state.interrupts)
                self.assertTrue(all(key.endswith(":345") for key in state.interrupts))
                await host.close()

    async def test_registered_policy_remains_enforced_at_every_turn(self):
        with tempfile.TemporaryDirectory() as temporary, FakeHermes() as state:
            with patch.dict(os.environ):
                host = GatewayHost(Path(temporary), verify_runtime=lambda: None)
                await host.start()
                state.policy = SimpleNamespace(name="unrestricted", allowed_tool_names=None)
                with self.assertRaises(ProtocolError):
                    await host.infer(request())
                self.assertEqual(host.runner._agent_cache, {})
                await host.close()

    async def test_failed_provider_response_is_not_published_as_a_draft(self):
        with tempfile.TemporaryDirectory() as temporary, FakeHermes() as state:
            with patch.dict(os.environ):
                host = GatewayHost(Path(temporary), verify_runtime=lambda: None)
                await host.start()
                state.provider_failed = True
                with self.assertRaises(ProtocolError) as raised:
                    await host.infer(request())
                self.assertEqual(raised.exception.code, "inference-failed")
                await host.close()

    async def test_fast_successful_fallback_retains_exact_agent_after_cache_eviction(self):
        with tempfile.TemporaryDirectory() as temporary, FakeHermes() as state:
            with patch.dict(os.environ):
                host = GatewayHost(Path(temporary), verify_runtime=lambda: None)
                await host.start()
                state.fast_evict = True
                self.assertEqual(await host.infer(request()), "Proposed reply")
                self.assertEqual(host.runner._agent_cache, {})
                await host.close()

    async def test_failed_constructor_releases_own_pid_lock_and_scoped_database(self):
        with tempfile.TemporaryDirectory() as temporary, FakeHermes() as state:
            host = GatewayHost(Path(temporary), verify_runtime=lambda: None)
            state.constructor_failed = True
            with self.assertRaises(ValueError):
                await host.start()
            self.assertFalse(state.locked)
            self.assertFalse(state.pid)
            self.assertTrue(state.databases[0].closed)
            await host.close()

    async def test_source_drift_during_model_call_fences_completed_output(self):
        with tempfile.TemporaryDirectory() as temporary, FakeHermes():
            with patch.dict(os.environ):
                changed = False

                def verify():
                    if changed:
                        raise ProtocolError("policy-unavailable")

                host = GatewayHost(Path(temporary), verify_runtime=verify)
                await host.start()
                turn = asyncio.create_task(host.infer(request()))
                await asyncio.sleep(0.02)
                changed = True
                with self.assertRaises(ProtocolError) as raised:
                    await turn
                self.assertEqual(raised.exception.code, "policy-unavailable")
                await host.close()


if __name__ == "__main__":
    unittest.main()
