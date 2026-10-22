import json
import unittest

from bridge_protocol import FrameDecoder, MAX_FRAME, ProtocolError, parse_frame, payload_digest


def request(request_id="tg_test", **changes):
    return {"v": 1, "type": "request", "id": request_id, "groupId": "-100123",
            "senderId": "345", "messageId": "7", "groupTitle": "Client",
            "text": "Please draft a reply", **changes}


def encoded(frame):
    return json.dumps(frame).encode()


class ProtocolTests(unittest.TestCase):
    def test_split_and_coalesced_frames(self):
        decoder = FrameDecoder()
        data = encoded(request()) + b"\n" + encoded({"v": 1, "type": "cancel", "id": "tg_test"}) + b"\n"
        frames = []
        for byte in data:
            frames.extend(decoder.feed(bytes([byte])))
        self.assertEqual([frame["type"] for frame in frames], ["request", "cancel"])
        decoder.finish()

    def test_incomplete_and_oversize_frames_fail_closed(self):
        decoder = FrameDecoder()
        decoder.feed(b"{")
        with self.assertRaises(ProtocolError):
            decoder.finish()
        with self.assertRaises(ProtocolError):
            FrameDecoder().feed(b" " * (MAX_FRAME + 1))
        with self.assertRaises(ProtocolError):
            FrameDecoder().feed(b" " * (MAX_FRAME + 1) + b"\n")

    def test_invalid_input_shapes_do_not_enter_gateway(self):
        invalid = [request(v=True), request(v=2), request(groupId="123"),
                   request(senderId="0"), request(messageId="01"), request(id="../profile"),
                   request(text=" "), request(text="x" * 16001), request(text=" " * 16000 + "x"),
                   request(groupTitle="x" * 257),
                   request(extra="secret"), request(text={"private": "value"}),
                   request(text="\ud800"), {"v": 1, "type": "hello", "nonce": "short"}]
        for value in invalid:
            with self.subTest(value=str(value)[:60]), self.assertRaises(ProtocolError):
                parse_frame(encoded(value))
        for raw in (b'{"v":1,"v":1,"type":"cancel","id":"test"}', b"\xff", b"[]", b"null"):
            with self.assertRaises(ProtocolError):
                parse_frame(raw)

    def test_hello_nonce_and_canonical_digest(self):
        hello = {"v": 1, "type": "hello", "nonce": "A" * 43}
        self.assertEqual(parse_frame(encoded(hello)), hello)
        first = request()
        self.assertEqual(payload_digest(first), payload_digest(dict(reversed(list(first.items())))))
        self.assertNotEqual(payload_digest(first), payload_digest(request(text="changed")))


if __name__ == "__main__":
    unittest.main()
