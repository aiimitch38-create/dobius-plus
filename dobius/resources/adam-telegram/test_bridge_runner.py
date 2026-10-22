import asyncio
import json
from pathlib import Path
import socket
import tempfile
import unittest

from bridge_protocol import PLATFORM
from bridge_receipts import ReceiptStore
from bridge_runner import ParentPipe, serve
from test_bridge_protocol import request


class FakeGateway:
    def __init__(self):
        self.calls = []
        self.closed = False

    async def infer(self, frame):
        self.calls.append(frame)
        return "Draft only, awaiting approval"

    def cancel(self, _):
        pass

    async def close(self):
        self.closed = True


class RunnerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.parent, child = socket.socketpair()
        self.parent.setblocking(False)
        self.pipe = ParentPipe(child.detach())
        self.gateway = FakeGateway()
        self.boots = 0
        self.buffer = b""

        async def start():
            self.boots += 1
            return self.gateway

        self.task = asyncio.create_task(serve(self.pipe, start, lambda:
                                      ReceiptStore(Path(self.temp.name) / "receipts")))

    async def asyncTearDown(self):
        self.parent.close()
        await asyncio.wait_for(self.task, timeout=2)
        self.temp.cleanup()

    async def send(self, frame):
        await asyncio.get_running_loop().sock_sendall(self.parent, json.dumps(frame).encode() + b"\n")

    async def receive(self):
        while b"\n" not in self.buffer:
            chunk = await asyncio.wait_for(asyncio.get_running_loop().sock_recv(self.parent, 65536), 2)
            if not chunk:
                self.fail("pipe closed before response")
            self.buffer += chunk
        raw, _, self.buffer = self.buffer.partition(b"\n")
        return json.loads(raw)

    async def test_fd_handshake_precedes_gateway_and_replies_correlate(self):
        await asyncio.sleep(0)
        self.assertEqual(self.boots, 0)
        nonce = "Z" * 43
        await self.send({"v": 1, "type": "hello", "nonce": nonce})
        self.assertEqual(await self.receive(), {"v": 1, "type": "ready", "nonce": nonce,
                         "profile": "adam", "platform": PLATFORM, "policy": "no-tools"})
        await self.send(request())
        reply = await self.receive()
        self.assertEqual(reply["id"], "tg_test")
        self.assertEqual(reply["type"], "reply")
        self.assertEqual(len(self.gateway.calls), 1)
        await self.send(request())
        self.assertEqual(await self.receive(), reply)
        self.assertEqual(len(self.gateway.calls), 1)
        self.parent.shutdown(socket.SHUT_WR)
        await asyncio.wait_for(self.task, timeout=2)
        self.assertTrue(self.gateway.closed)

    async def test_request_before_hello_fails_without_starting_gateway(self):
        await self.send(request())
        self.assertEqual((await self.receive())["code"], "protocol-error")
        self.assertEqual(self.boots, 0)

    async def test_malformed_frame_terminates_without_exception_details(self):
        await asyncio.get_running_loop().sock_sendall(self.parent, b'{"private": "credential"}\n')
        error = await self.receive()
        self.assertEqual(error["code"], "protocol-error")
        self.assertNotIn("credential", str(error))
        self.assertEqual(self.boots, 0)

    async def test_policy_readiness_failure_does_not_emit_ready(self):
        from bridge_protocol import ProtocolError
        self.parent.close()
        await self.task
        self.parent, child = socket.socketpair()
        self.parent.setblocking(False)
        self.pipe = ParentPipe(child.detach())

        async def fail():
            raise ProtocolError("policy-unavailable")

        self.task = asyncio.create_task(serve(self.pipe, fail, lambda: None))
        await self.send({"v": 1, "type": "hello", "nonce": "A" * 43})
        error = await self.receive()
        self.assertEqual(error["type"], "error")
        self.assertEqual(error["code"], "policy-unavailable")


if __name__ == "__main__":
    unittest.main()
