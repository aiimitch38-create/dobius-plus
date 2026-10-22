#!/usr/bin/env python3
"""Main-owned FD3 bridge into the installed Adam-profile Hermes gateway."""

import argparse
import asyncio
import json
import logging
import os
from pathlib import Path
import socket
import sys

from bridge_dispatch import BridgeDispatch
from bridge_protocol import FrameDecoder, PLATFORM, ProtocolError, error_frame
from bridge_receipts import ReceiptStore
from policy_manifest import verify_core_policy


class ParentPipe:
    def __init__(self, descriptor=3):
        if os.name != "posix":
            # Node's Windows named-pipe handles are not POSIX socket FDs.
            # Fail closed rather than silently replacing the private channel.
            raise ProtocolError("gateway-unavailable")
        self.socket = socket.socket(fileno=descriptor)
        self.socket.setblocking(False)
        self.decoder = FrameDecoder()
        self.frames = []
        self.write_lock = asyncio.Lock()

    async def receive(self):
        while not self.frames:
            chunk = await asyncio.get_running_loop().sock_recv(self.socket, 65536)
            if not chunk:
                self.decoder.finish()
                return None
            self.frames.extend(self.decoder.feed(chunk))
        return self.frames.pop(0)

    async def emit(self, frame):
        raw = (json.dumps(frame, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
        async with self.write_lock:
            await asyncio.get_running_loop().sock_sendall(self.socket, raw)

    def close(self):
        self.socket.close()


def configure_hermes(hermes_root, profile_home):
    root = Path(hermes_root).resolve(strict=True)
    profile = Path(profile_home).resolve(strict=True)
    if not (root / "gateway" / "run.py").is_file() or not (root / "run_agent.py").is_file():
        raise ProtocolError("gateway-unavailable")
    if profile.name != "adam" or profile.parent.name != "profiles" or not profile.is_dir():
        raise ProtocolError("profile-unavailable")
    verify_core_policy(root)
    os.environ["HERMES_HOME"] = str(profile)
    os.environ["_HERMES_GATEWAY"] = "1"
    # Never inherit TUI/codex terminal identity into this dedicated process.
    for name in ("HERMES_SESSION_ID", "HERMES_GATEWAY_SESSION_KEY", "HERMES_CHAT_ID",
                 "HERMES_THREAD_ID", "HERMES_USER_ID"):
        os.environ.pop(name, None)
    sys.path.insert(0, str(root))
    from hermes_constants import get_hermes_home
    from hermes_cli.profiles import get_active_profile_name
    if get_hermes_home().resolve() != profile or get_active_profile_name() != "adam":
        raise ProtocolError("profile-unavailable")
    return profile


async def serve(pipe, start_gateway, open_receipts):
    gateway = None
    receipts = None
    dispatch = None
    try:
        hello = await asyncio.wait_for(pipe.receive(), timeout=10)
        if hello is None or hello["type"] != "hello":
            raise ProtocolError()
        gateway = await start_gateway()
        receipts = open_receipts()
        dispatch = BridgeDispatch(receipts, gateway, pipe.emit,
                                  verify_runtime=getattr(gateway, "verify_runtime", None))
        if dispatch.verify_runtime:
            dispatch.verify_runtime()
        await pipe.emit({"v": 1, "type": "ready", "nonce": hello["nonce"],
                         "profile": "adam", "platform": PLATFORM, "policy": "no-tools"})
        while True:
            frame = await pipe.receive()
            if frame is None:
                break
            if frame["type"] == "hello":
                raise ProtocolError()
            await dispatch.accept(frame)
    except ProtocolError as error:
        try:
            await pipe.emit(error_frame("", error.code))
        except Exception:
            pass
    except Exception:
        try:
            await pipe.emit(error_frame("", "gateway-unavailable"))
        except Exception:
            pass
    finally:
        if dispatch:
            await dispatch.shutdown()
        if gateway:
            await gateway.close()
        if receipts:
            receipts.close()
        pipe.close()


async def main(args):
    os.umask(0o077)
    logging.disable(logging.CRITICAL)
    pipe = ParentPipe()
    state = {}

    async def start_gateway():
        profile = configure_hermes(args.hermes_root, args.profile_home)
        from gateway_host import GatewayHost
        gateway = GatewayHost(profile, verify_runtime=lambda: verify_core_policy(args.hermes_root))
        state["profile"] = profile
        try:
            await gateway.start()
        except Exception:
            await gateway.close()
            raise
        return gateway

    await serve(pipe, start_gateway, lambda: ReceiptStore(state["profile"] / "dobius-telegram-bridge"))
    # asyncio's executor shutdown can otherwise wait indefinitely for a provider
    # thread that ignores cancellation. Receipts are committed before this exit;
    # the OS releases the gateway lock only when the process actually dies.
    os._exit(0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes-root", required=True)
    parser.add_argument("--profile-home", required=True)
    try:
        asyncio.run(main(parser.parse_args()))
    except Exception:
        # Provider/profile SDK exception strings must never reach app logs.
        sys.exit(1)
