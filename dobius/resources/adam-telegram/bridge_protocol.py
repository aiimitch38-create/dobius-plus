"""Bounded, closed-schema NDJSON on the parent-owned duplex descriptor."""

import hashlib
import json
import re

MAX_FRAME = 128 * 1024
MAX_TEXT = 16000
PLATFORM = "dobius_adam_telegram"
ERROR_CODES = frozenset({
    "protocol-error", "request-conflict", "request-interrupted", "cancelled",
    "inference-failed", "gateway-busy", "policy-unavailable", "profile-unavailable",
    "gateway-unavailable", "output-unavailable", "receipt-unavailable", "request-not-found",
})


class ProtocolError(Exception):
    def __init__(self, code="protocol-error"):
        self.code = code if code in ERROR_CODES else "protocol-error"
        super().__init__(self.code)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError()
        result[key] = value
    return result


def parse_frame(raw):
    try:
        if not raw or len(raw) > MAX_FRAME:
            raise ProtocolError()
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs)
        if not isinstance(value, dict) or type(value.get("v")) is not int or value["v"] != 1:
            raise ProtocolError()
        kind = value.get("type")
        if kind == "hello":
            if set(value) != {"v", "type", "nonce"} or not _matches(value["nonce"], r"[A-Za-z0-9_-]{43}"):
                raise ProtocolError()
        elif kind == "cancel":
            if set(value) != {"v", "type", "id"} or not valid_id(value["id"]):
                raise ProtocolError()
        elif kind == "request":
            fields = {"v", "type", "id", "groupId", "senderId", "messageId", "groupTitle", "text"}
            if set(value) != fields or not valid_id(value["id"]):
                raise ProtocolError()
            if not _matches(value["groupId"], r"-[1-9][0-9]{0,19}"):
                raise ProtocolError()
            if not all(_matches(value[key], r"[1-9][0-9]{0,19}") for key in ("senderId", "messageId")):
                raise ProtocolError()
            if not isinstance(value["groupTitle"], str) or len(value["groupTitle"]) > 256:
                raise ProtocolError()
            if (not isinstance(value["text"], str) or not value["text"].strip()
                    or len(value["text"]) > MAX_TEXT):
                raise ProtocolError()
            # Surrogate escapes cannot be emitted safely or hashed consistently across runtimes.
            for key in ("text", "groupTitle"):
                value[key].encode("utf-8", errors="strict")
        else:
            raise ProtocolError()
        return value
    except (ValueError, UnicodeError, TypeError, KeyError, RecursionError):
        raise ProtocolError() from None


def _matches(value, pattern):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def valid_id(value):
    return _matches(value, r"[A-Za-z0-9_-]{1,128}")


def payload_digest(request):
    return hashlib.sha256(json.dumps(request, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def error_frame(request_id, code):
    if code not in ERROR_CODES:
        code = "inference-failed"
    return {"v": 1, "type": "error", "id": request_id, "code": code}


class FrameDecoder:
    def __init__(self):
        self.buffer = bytearray()

    def feed(self, chunk):
        self.buffer.extend(chunk)
        frames = []
        while b"\n" in self.buffer:
            raw, _, tail = self.buffer.partition(b"\n")
            self.buffer = bytearray(tail)
            frames.append(parse_frame(raw))
        if len(self.buffer) > MAX_FRAME:
            raise ProtocolError()
        return frames

    def finish(self):
        if self.buffer:
            raise ProtocolError()
