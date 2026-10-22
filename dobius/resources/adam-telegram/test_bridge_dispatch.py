import asyncio
import os
from pathlib import Path
import tempfile
import unittest

from bridge_dispatch import BridgeDispatch
from bridge_receipts import ReceiptStore
from bridge_protocol import ProtocolError, payload_digest
from test_bridge_protocol import request


class FakeGateway:
    def __init__(self):
        self.calls = []
        self.cancelled = []
        self.release = asyncio.Event()

    async def infer(self, frame):
        self.calls.append(frame)
        await self.release.wait()
        return "A proposed reply"

    def cancel(self, frame):
        self.cancelled.append(frame["id"])


class DispatchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "receipts"
        self.store = ReceiptStore(self.path)
        self.gateway = FakeGateway()
        self.output = []

        async def emit(frame):
            self.output.append(frame)

        self.dispatch = BridgeDispatch(self.store, self.gateway, emit)

    async def asyncTearDown(self):
        self.gateway.release.set()
        await self.dispatch.shutdown()
        self.store.close()
        self.temp.cleanup()

    async def settle(self):
        for _ in range(30):
            if not self.dispatch.active:
                return
            await asyncio.sleep(0.001)
        self.fail("turn did not settle")

    async def test_duplicate_pending_and_terminal_do_not_repeat_inference(self):
        frame = request()
        await self.dispatch.accept(frame)
        await self.dispatch.accept(frame)
        await asyncio.sleep(0)
        self.assertEqual(len(self.gateway.calls), 1)
        self.gateway.release.set()
        await self.settle()
        await self.dispatch.accept(frame)
        self.assertEqual(len(self.gateway.calls), 1)
        self.assertEqual(len(self.output), 2)
        self.assertEqual(self.output[0], self.output[1])
        self.assertEqual(self.output[0]["type"], "reply")

    async def test_conflicting_id_is_rejected_without_dispatch(self):
        await self.dispatch.accept(request())
        await self.dispatch.accept(request(text="conflicting text"))
        self.assertEqual(self.output[-1]["code"], "request-conflict")

    async def test_cancel_fences_late_output_and_preserves_serial_lane(self):
        await self.dispatch.accept(request("first"))
        await asyncio.sleep(0)
        await self.dispatch.accept({"v": 1, "type": "cancel", "id": "first"})
        await self.dispatch.accept(request("second", messageId="8"))
        await asyncio.sleep(0)
        self.assertEqual([f["id"] for f in self.gateway.calls], ["first"])
        self.assertEqual(self.gateway.cancelled, ["first"])
        self.gateway.release.set()
        await self.settle()
        self.assertEqual([f["id"] for f in self.gateway.calls], ["first", "second"])
        self.assertEqual([(f["id"], f["type"]) for f in self.output],
                         [("first", "error"), ("second", "reply")])
        await self.dispatch.accept(request("first"))
        self.assertEqual(self.output[-1]["code"], "cancelled")

    async def test_cancel_before_scheduled_turn_never_infers(self):
        await self.dispatch.accept(request())
        await self.dispatch.cancel("tg_test")
        await self.settle()
        self.assertEqual(self.gateway.calls, [])
        self.assertEqual(self.output[-1]["code"], "cancelled")

    async def test_distinct_senders_and_groups_have_independent_lanes(self):
        await self.dispatch.accept(request("one"))
        await self.dispatch.accept(request("two", senderId="346"))
        await self.dispatch.accept(request("three", groupId="-100124"))
        await asyncio.sleep(0)
        self.assertEqual(len(self.gateway.calls), 2)
        self.gateway.release.set()
        await self.settle()
        self.assertEqual(len(self.gateway.calls), 3)

    async def test_restart_uncertain_admission_never_infers(self):
        frame = request()
        self.store.admit(frame["id"], payload_digest(frame))
        self.store.close()
        self.store = ReceiptStore(self.path)
        self.dispatch.receipts = self.store
        await self.dispatch.accept(frame)
        self.assertEqual(self.gateway.calls, [])
        self.assertEqual(self.output[-1]["code"], "request-interrupted")

    async def test_completed_receipt_replays_after_restart(self):
        self.gateway.release.set()
        await self.dispatch.accept(request())
        await self.settle()
        first = self.output[-1]
        self.store.close()
        self.store = ReceiptStore(self.path)
        self.dispatch.receipts = self.store
        await self.dispatch.accept(request())
        self.assertEqual(self.output[-1], first)
        self.assertEqual(len(self.gateway.calls), 1)

    async def test_shutdown_persists_cancel_and_discards_late_reply(self):
        await self.dispatch.accept(request())
        await asyncio.sleep(0)
        self.gateway.release.set()
        await self.dispatch.shutdown()
        self.assertEqual(self.store.lookup("tg_test")[1]["code"], "cancelled")
        self.assertEqual(self.output, [])

    async def test_raw_provider_errors_are_never_exposed(self):
        async def fail(_):
            raise ValueError("private provider api_key=secret")
        self.gateway.infer = fail
        await self.dispatch.accept(request())
        await self.settle()
        self.assertEqual(self.output[-1]["code"], "inference-failed")
        self.assertNotIn("secret", str(self.output))

    async def test_no_such_cancel_has_closed_error(self):
        await self.dispatch.cancel("unknown")
        self.assertEqual(self.output[-1]["code"], "request-not-found")

    async def test_source_drift_blocks_admission_but_keeps_cancel_available(self):
        await self.dispatch.accept(request())
        await asyncio.sleep(0)

        def changed_source():
            raise ProtocolError("policy-unavailable")

        self.dispatch.verify_runtime = changed_source
        await self.dispatch.accept(request("new"))
        self.assertEqual(self.output[-1]["code"], "policy-unavailable")
        await self.dispatch.accept({"v": 1, "type": "cancel", "id": "tg_test"})
        self.assertEqual(self.output[-1]["code"], "cancelled")
        self.assertEqual(self.gateway.cancelled, ["tg_test"])

    async def test_overflow_is_terminal_and_does_not_start_another_model_turn(self):
        for index in range(33):
            await self.dispatch.accept(request(f"request_{index}", senderId=str(index + 1)))
        await asyncio.sleep(0)
        self.assertEqual(len(self.dispatch.active), 32)
        self.assertEqual(len(self.gateway.calls), 2)
        self.assertEqual(self.output[-1]["code"], "gateway-busy")
        self.assertEqual(self.store.lookup("request_32")[1], self.output[-1])

    async def test_receipt_failure_still_interrupts_and_fences_cancelled_turn(self):
        await self.dispatch.accept(request())
        await asyncio.sleep(0)
        finish = self.store.finish

        def disk_failed(*_):
            raise OSError("private disk metadata")

        self.store.finish = disk_failed
        await self.dispatch.cancel("tg_test")
        self.assertEqual(self.gateway.cancelled, ["tg_test"])
        self.assertEqual(self.output[-1]["code"], "receipt-unavailable")
        self.gateway.release.set()
        await self.settle()
        self.assertEqual(len(self.output), 1)
        self.store.finish = finish


class ReceiptPermissionsTests(unittest.TestCase):
    def test_private_files_and_symlink_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "private"
            store = ReceiptStore(path)
            self.assertEqual(path.stat().st_mode & 0o777, 0o700)
            self.assertEqual((path / "receipts.sqlite3").stat().st_mode & 0o777, 0o600)
            store.close()
            alias = Path(temporary) / "alias"
            alias.symlink_to(path, target_is_directory=True)
            with self.assertRaises(ProtocolError):
                ReceiptStore(alias)
            os.chmod(path / "receipts.sqlite3", 0o644)
            with self.assertRaises(ProtocolError):
                ReceiptStore(path)


if __name__ == "__main__":
    unittest.main()
