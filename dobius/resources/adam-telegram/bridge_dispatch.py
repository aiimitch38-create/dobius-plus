"""Correlated admission, serial lanes and cancellation around a gateway adapter."""

import asyncio
from dataclasses import dataclass

from bridge_protocol import MAX_TEXT, ProtocolError, error_frame, payload_digest


@dataclass
class Turn:
    request: dict
    task: object = None
    cancelled: bool = False


class BridgeDispatch:
    def __init__(self, receipts, gateway, emit, verify_runtime=None):
        self.receipts = receipts
        self.gateway = gateway
        self.emit = emit
        self.active = {}
        self.lanes = {}
        self.closed = False
        self.verify_runtime = verify_runtime
        self.inference_slots = asyncio.Semaphore(2)

    async def accept(self, request):
        request_id = request["id"]
        if self.closed:
            return
        if request["type"] == "cancel":
            await self.cancel(request_id)
            return
        try:
            if self.verify_runtime:
                self.verify_runtime()
            is_new, response = self.receipts.admit(request_id, payload_digest(request))
            if not is_new:
                if response is not None:
                    await self.emit(response)
                # A pending duplicate subscribes to its original terminal receipt.
                return
            if len(self.active) >= 32:
                response = self.receipts.finish(request_id, error_frame(request_id, "gateway-busy"))
                await self.emit(response)
                return
            turn = Turn(request)
            self.active[request_id] = turn
            turn.task = asyncio.create_task(self._run(turn))
        except ProtocolError as error:
            await self.emit(error_frame(request_id, error.code))
        except Exception:
            await self.emit(error_frame(request_id, "receipt-unavailable"))

    async def _run(self, turn):
        request = turn.request
        request_id = request["id"]
        lane = (request["groupId"], request["senderId"])
        lock = self.lanes.setdefault(lane, asyncio.Lock())
        try:
            async with lock:
                async with self.inference_slots:
                    if turn.cancelled or self.closed:
                        return
                    result = await self.gateway.infer(request)
                if turn.cancelled or self.closed:
                    return
                if not isinstance(result, str) or not 1 <= len(result.strip()) <= MAX_TEXT:
                    raise ProtocolError("output-unavailable")
                result.encode("utf-8", errors="strict")
                response = {"v": 1, "type": "reply", "id": request_id, "text": result.strip()}
                response = self.receipts.finish(request_id, response)
                await self.emit(response)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if not turn.cancelled and not self.closed:
                code = error.code if isinstance(error, ProtocolError) else "inference-failed"
                try:
                    response = self.receipts.finish(request_id, error_frame(request_id, code))
                except Exception:
                    response = error_frame(request_id, "receipt-unavailable")
                try:
                    await self.emit(response)
                except (OSError, ConnectionError):
                    pass
        finally:
            if self.active.get(request_id) is turn:
                self.active.pop(request_id)
            if not lock.locked() and not any(
                (t.request["groupId"], t.request["senderId"]) == lane for t in self.active.values()
            ):
                self.lanes.pop(lane, None)

    async def cancel(self, request_id):
        turn = self.active.get(request_id)
        if turn is not None:
            turn.cancelled = True
            try:
                response = self.receipts.finish(request_id, error_frame(request_id, "cancelled"))
            except Exception:
                response = error_frame(request_id, "receipt-unavailable")
            # Do not cancel the awaiting coroutine: its inference thread may still
            # own the session. Keep the lane leased until that exact turn settles.
            self.gateway.cancel(turn.request)
            await self.emit(response)
            return
        exists, response = self.receipts.lookup(request_id)
        await self.emit(response or error_frame(request_id, "request-interrupted" if exists else "request-not-found"))

    async def shutdown(self):
        self.closed = True
        for turn in list(self.active.values()):
            turn.cancelled = True
            try:
                self.receipts.finish(turn.request["id"], error_frame(turn.request["id"], "cancelled"))
            except Exception:
                pass
            self.gateway.cancel(turn.request)
        tasks = [turn.task for turn in self.active.values() if turn.task]
        if tasks:
            await asyncio.wait(tasks, timeout=5)
