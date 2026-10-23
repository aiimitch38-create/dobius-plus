"""Hermetic filesystem race and lifecycle tests for the descriptor bridge."""

from __future__ import annotations

import json
import importlib.util
import os
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from pathlib import Path

BRIDGE = Path(__file__).with_name("descriptor-directory-bridge.py")
BRIDGE_SPEC = importlib.util.spec_from_file_location("descriptor_directory_bridge", BRIDGE)
assert BRIDGE_SPEC and BRIDGE_SPEC.loader
BRIDGE_MODULE = importlib.util.module_from_spec(BRIDGE_SPEC)
sys.modules[BRIDGE_SPEC.name] = BRIDGE_MODULE
BRIDGE_SPEC.loader.exec_module(BRIDGE_MODULE)


def identity(path: Path) -> dict[str, str]:
    info = path.stat(follow_symlinks=False)
    return {"dev": str(info.st_dev), "ino": str(info.st_ino)}


class BridgeProcess:
    def __init__(self) -> None:
        self.process = subprocess.Popen(
            [sys.executable, "-I", str(BRIDGE)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.sequence = 0

    def call(self, operation: str, **values: object) -> object:
        assert self.process.stdin and self.process.stdout
        self.sequence += 1
        request_id = str(self.sequence)
        wire = json.dumps({"id": request_id, "op": operation, **values}, ensure_ascii=True)
        self.process.stdin.write(wire.encode("ascii") + b"\n")
        self.process.stdin.flush()
        response = json.loads(self.process.stdout.readline())
        if response["id"] != request_id:
            raise AssertionError(f"out-of-order bridge response: {response!r}")
        if not response["ok"]:
            raise BridgeCallError(response["error"])
        return response["result"]

    def close(self) -> int:
        if self.process.stdin:
            self.process.stdin.close()
        try:
            result = self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)
            raise
        finally:
            if self.process.stdout:
                self.process.stdout.close()
            if self.process.stderr:
                self.process.stderr.close()
        return result


class BridgeCallError(Exception):
    pass


@unittest.skipUnless(os.name == "posix", "descriptor-relative bridge is POSIX-only")
class DescriptorDirectoryBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="dobius-catalog-bridge-")
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "trusted-root"
        self.root.mkdir()
        self.bridge = BridgeProcess()
        capabilities = self.bridge.call("capabilities")
        self.assertEqual(capabilities, {"supported": True, "protocol": 1})
        try:
            self.root_identity = self.bridge.call("capture_root_identity", path=str(self.root))
        except BridgeCallError as error:
            if str(error) == "unsupported_identity_provider":
                self.skipTest("temporary test filesystem has no approved incarnation provider")
            raise

    def tearDown(self) -> None:
        if getattr(self, "bridge", None) is not None:
            self.bridge.close()
        self.temp.cleanup()

    def open_root(self, path: Path | None = None) -> str:
        selected = path or self.root
        result = self.bridge.call("open_root", path=str(selected), identity=self.root_identity)
        return result["handleId"]

    def test_walk_preserves_posix_backslash_and_unicode_components(self) -> None:
        backslash_name = "literal\\component"
        unicode_name = "café-雪"
        (self.root / backslash_name).write_text("metadata only; never read")
        (self.root / unicode_name).mkdir()
        root_id = self.open_root()

        names = set()
        while name := self.bridge.call("read", handleId=root_id):
            names.add(name["name"])
        self.assertEqual(names, {backslash_name, unicode_name})

        backslash_stat = self.bridge.call("lstat_child", parentHandleId=root_id, name=backslash_name)
        self.assertEqual(backslash_stat["kind"], "file")
        child = self.bridge.call("open_child", parentHandleId=root_id, name=unicode_name)
        self.assertEqual(child["identity"], identity(self.root / unicode_name))
        self.assertTrue(
            self.bridge.call(
                "verify_child",
                parentHandleId=root_id,
                name=unicode_name,
                identity=child["identity"],
            )
        )
        self.bridge.call("close", handleId=child["handleId"])

    def test_root_open_rejects_symlink_components_and_identity_swap(self) -> None:
        outside = self.base / "outside"
        outside.mkdir()
        link = self.base / "root-link"
        link.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(BridgeCallError):
            self.open_root(link)

        intermediate = self.base / "intermediate-link"
        intermediate.symlink_to(outside, target_is_directory=True)
        (outside / "nested").mkdir()
        with self.assertRaises(BridgeCallError):
            self.open_root(intermediate / "nested")

        original = self.open_root()
        moved = self.base / "moved-root"
        self.root.rename(moved)
        self.root.mkdir()
        self.assertFalse(
            self.bridge.call(
                "verify_root",
                path=str(self.root),
                identity=self.root_identity,
                handleId=original,
            )
        )

    def test_native_token_mismatch_and_replacement_fail_closed(self) -> None:
        root_id = self.open_root()
        proof = self.root_identity
        wrong_proof = {
            **proof,
            "incarnation": {
                **proof["incarnation"],
                "token": str(int(proof["incarnation"]["token"]) + 1),
            },
        }
        with self.assertRaises(BridgeCallError):
            self.bridge.call("open_root", path=str(self.root), identity=wrong_proof)

        moved = self.base / "replaced-root"
        self.root.rename(moved)
        self.root.mkdir()
        replacement = self.bridge.call("capture_root_identity", path=str(self.root))
        self.assertNotEqual(replacement["incarnation"]["token"], proof["incarnation"]["token"])
        self.assertFalse(
            self.bridge.call(
                "verify_root", path=str(self.root), identity=proof, handleId=root_id
            )
        )
        with self.assertRaises(BridgeCallError):
            self.bridge.call("read", handleId=root_id)

    def test_native_identity_is_stable_when_children_change(self) -> None:
        before = self.bridge.call("capture_root_identity", path=str(self.root))
        (self.root / "ordinary-child").mkdir()
        after = self.bridge.call("capture_root_identity", path=str(self.root))
        self.assertEqual(after, before)

    def test_native_identity_capture_does_not_mutate_the_selected_directory(self) -> None:
        before = self.root.stat()
        self.bridge.call("capture_root_identity", path=str(self.root))
        after = self.root.stat()
        self.assertEqual((after.st_ino, after.st_mtime_ns, after.st_mode),
                         (before.st_ino, before.st_mtime_ns, before.st_mode))

    def test_native_identity_dto_rejects_unknown_provider_and_noncanonical_token(self) -> None:
        proofs = [
            {
                "dev": "1", "ino": "2",
                "incarnation": {"provider": "unknown", "scope": "0" * 32, "token": "1"},
            },
            {
                "dev": "1", "ino": "2",
                "incarnation": {
                    "provider": "darwin-apfs-file-id-v1", "scope": "0" * 32, "token": "01"
                },
            },
        ]
        for proof in proofs:
            with self.subTest(proof=proof), self.assertRaises(BridgeCallError):
                self.bridge.call("open_root", path=str(self.root), identity=proof)

    def test_child_symlink_and_fifo_are_metadata_only_and_never_followed(self) -> None:
        target = self.base / "outside-target"
        target.write_text("must not be read")
        (self.root / "link").symlink_to(target)
        os.mkfifo(self.root / "pipe")
        root_id = self.open_root()

        link_stat = self.bridge.call("lstat_child", parentHandleId=root_id, name="link")
        fifo_stat = self.bridge.call("lstat_child", parentHandleId=root_id, name="pipe")
        self.assertEqual(link_stat["kind"], "symlink")
        self.assertEqual(fifo_stat["kind"], "fifo")
        with self.assertRaises(BridgeCallError):
            self.bridge.call("open_child", parentHandleId=root_id, name="link")
        with self.assertRaises(BridgeCallError):
            self.bridge.call("open_child", parentHandleId=root_id, name="pipe")

    def test_preview_stats_use_full_width_decimal_identity_and_read_bounded_chunks(self) -> None:
        content = ("notes: café 雪\n".encode("utf-8") * 2400)[:20_000]
        path = self.root / "preview.txt"
        path.write_bytes(content)
        root_id = self.open_root()
        stat_result = self.bridge.call(
            "stat_preview", rootHandleId=root_id, rootId="root:test", generation="g:1",
            components=["preview.txt"],
        )
        self.assertEqual(stat_result["fileType"], "regular")
        for key in ("dev", "ino", "sizeBytes", "mtimeNs", "ctimeNs"):
            self.assertRegex(stat_result[key], r"^(0|[1-9][0-9]*)$")
        self.assertRegex(stat_result["fileVersion"], r"^[0-9a-f]{64}$")
        self.assertEqual(
            stat_result["fileVersion"],
            BRIDGE_MODULE.preview_file_version(
                "root:test", "g:1", self.root_identity, ["preview.txt"],
                {key: stat_result[key] for key in (
                    "dev", "ino", "sizeBytes", "mtimeNs", "ctimeNs", "fileType"
                )},
            ),
        )
        chunks: list[bytes] = []
        offset = 0
        while offset < len(content):
            size = min(BRIDGE_MODULE.MAX_PREVIEW_CHUNK_BYTES, len(content) - offset)
            chunk = self.bridge.call(
                "read_preview_chunk", rootHandleId=root_id, rootId="root:test", generation="g:1",
                components=["preview.txt"], expectedStat=stat_result, offset=offset, length=size,
            )
            data = __import__("base64").b64decode(chunk["dataBase64"], validate=True)
            self.assertLessEqual(len(data), 16 * 1024)
            self.assertEqual(chunk["offset"], offset)
            self.assertEqual(chunk["nextOffset"], offset + len(data))
            self.assertEqual(chunk["final"], chunk["nextOffset"] == len(content))
            chunks.append(data)
            offset = chunk["nextOffset"]
        self.assertEqual(b"".join(chunks), content)

    def test_stat_version_preserves_u64_values_and_ignores_diagnostic_birthtime(self) -> None:
        identity_value = {
            "dev": "18446744073709551615",
            "ino": "18446744073709551614",
            "sizeBytes": "16384",
            "mtimeNs": "18446744073709551613",
            "ctimeNs": "18446744073709551612",
            "fileType": "regular",
        }
        root = {
            "dev": "1", "ino": "2",
            "incarnation": {
                "provider": "linux-inode-generation-v1",
                "scope": "0123456789abcdef", "token": "3",
            },
        }
        expected = "a65e837891f1346a253123567fc35a67d04994cca3c570321971d290ac51bad3"
        token = BRIDGE_MODULE.preview_file_version(
            "root:x", "generation:1", root, ["café", "a\\b.txt"], identity_value
        )
        self.assertEqual(token, expected)
        root_with_diagnostic_time = {**root, "birthtimeNs": "90071992547409931234"}
        self.assertEqual(
            BRIDGE_MODULE.preview_file_version(
                "root:x", "generation:1", root_with_diagnostic_time,
                ["café", "a\\b.txt"], identity_value,
            ),
            expected,
        )

    def test_unrepresentable_preview_timestamp_does_not_break_metadata_lstat(self) -> None:
        entry = BRIDGE_MODULE.DescriptorBridge._entry_stat(SimpleNamespace(
            st_mode=stat.S_IFREG | 0o600,
            st_dev=1,
            st_ino=2,
            st_size=3,
            st_mtime_ns=-1,
            st_ctime_ns=1,
        ))
        self.assertEqual(entry["kind"], "file")
        self.assertNotIn("previewIdentity", entry)

    def test_preview_refuses_fifo_symlink_directory_and_oversized_file_promptly(self) -> None:
        (self.root / "pipe.txt").parent.mkdir(exist_ok=True)
        os.mkfifo(self.root / "pipe.txt")
        (self.root / "outside.txt").write_text("outside")
        (self.root / "link.txt").symlink_to(self.root / "outside.txt")
        (self.root / "folder.txt").mkdir()
        (self.root / "large.txt").write_bytes(b"x" * (256 * 1024 + 1))
        root_id = self.open_root()
        started = time.monotonic()
        for name in ("pipe.txt", "link.txt", "folder.txt"):
            with self.subTest(name=name), self.assertRaises(BridgeCallError):
                self.bridge.call(
                    "stat_preview", rootHandleId=root_id, rootId="root:test", generation="g:1",
                    components=[name],
                )
        with self.assertRaisesRegex(BridgeCallError, "too_large"):
            self.bridge.call(
                "stat_preview", rootHandleId=root_id, rootId="root:test", generation="g:1",
                components=["large.txt"],
            )
        self.assertLess(time.monotonic() - started, 1.0)

    def test_preview_final_open_is_nonblocking_when_regular_file_is_replaced_by_fifo(self) -> None:
        target = self.root / "fifo-race.txt"
        target.write_text("initial")
        bridge = BRIDGE_MODULE.DescriptorBridge()
        opened = bridge.dispatch({
            "id": "1", "op": "open_root", "path": str(self.root), "identity": self.root_identity,
        })
        original_open = os.open
        swapped = False
        saw_nonblocking_open = False

        def replace_before_final_open(path: object, flags: int, *args: object, **kwargs: object) -> int:
            nonlocal swapped, saw_nonblocking_open
            if path == "fifo-race.txt" and kwargs.get("dir_fd") is not None and not swapped:
                target.unlink()
                os.mkfifo(target)
                swapped = True
                saw_nonblocking_open = bool(flags & os.O_NONBLOCK)
            return original_open(path, flags, *args, **kwargs)

        started = time.monotonic()
        try:
            with patch.object(os, "open", side_effect=replace_before_final_open):
                with self.assertRaises(BRIDGE_MODULE.ProtocolError):
                    bridge.dispatch({
                        "id": "2", "op": "stat_preview", "rootHandleId": opened["handleId"],
                        "rootId": "root:test", "generation": "g:1", "components": ["fifo-race.txt"],
                    })
            self.assertTrue(swapped)
            self.assertTrue(saw_nonblocking_open)
            self.assertLess(time.monotonic() - started, 1.0)
        finally:
            bridge.close_all()

    def test_preview_rejects_stale_version_and_unsafe_components(self) -> None:
        target = self.root / "version.txt"
        target.write_text("version one")
        root_id = self.open_root()
        expected = self.bridge.call(
            "stat_preview", rootHandleId=root_id, rootId="root:test", generation="g:1",
            components=["version.txt"],
        )
        target.write_text("version two")
        with self.assertRaises(BridgeCallError):
            self.bridge.call(
                "read_preview_chunk", rootHandleId=root_id, rootId="root:test", generation="g:1",
                components=["version.txt"], expectedStat=expected, offset=0, length=11,
            )
        for components in (["..", "outside"], ["a/b"], [""], ["."]):
            with self.subTest(components=components), self.assertRaises(BridgeCallError):
                self.bridge.call(
                    "stat_preview", rootHandleId=root_id, rootId="root:test", generation="g:1",
                    components=components,
                )

    def test_stat_preview_rejects_same_size_rewrite_before_final_fstat(self) -> None:
        target = self.root / "race-stat.txt"
        target.write_bytes(b"before")
        bridge = BRIDGE_MODULE.DescriptorBridge()
        opened = bridge.dispatch({
            "id": "1", "op": "open_root", "path": str(self.root), "identity": self.root_identity,
        })
        original_open = os.open
        original_fstat = os.fstat
        target_fd: int | None = None
        target_fstats = 0
        rewrote = False

        def track_open(path: object, flags: int, *args: object, **kwargs: object) -> int:
            nonlocal target_fd
            fd = original_open(path, flags, *args, **kwargs)
            if path == "race-stat.txt" and kwargs.get("dir_fd") is not None:
                target_fd = fd
            return fd

        def rewrite_on_final_fstat(fd: int) -> os.stat_result:
            nonlocal target_fstats, rewrote
            if fd == target_fd:
                target_fstats += 1
                if target_fstats == 2:
                    with target.open("r+b") as writer:
                        self.assertEqual(writer.write(b"after!"), 6)
                        writer.flush()
                    current = original_fstat(fd)
                    os.utime(
                        target,
                        ns=(current.st_atime_ns, max(current.st_mtime_ns + 3_000_000_000,
                                                     time.time_ns() + 3_000_000_000)),
                    )
                    rewrote = True
            return original_fstat(fd)

        try:
            with patch.object(os, "open", side_effect=track_open), \
                 patch.object(os, "fstat", side_effect=rewrite_on_final_fstat):
                with self.assertRaisesRegex(BRIDGE_MODULE.ProtocolError, "identity_changed"):
                    bridge.dispatch({
                        "id": "2", "op": "stat_preview", "rootHandleId": opened["handleId"],
                        "rootId": "root:test", "generation": "g:1", "components": ["race-stat.txt"],
                    })
            self.assertTrue(rewrote)
            self.assertEqual(target.stat().st_size, 6)
            self.assertEqual(target.read_bytes(), b"after!")
        finally:
            bridge.close_all()

    def test_preview_chunk_rejects_same_size_rewrite_between_fd_and_name_stat(self) -> None:
        target = self.root / "race-chunk.txt"
        target.write_bytes(b"before")
        bridge = BRIDGE_MODULE.DescriptorBridge()
        opened = bridge.dispatch({
            "id": "1", "op": "open_root", "path": str(self.root), "identity": self.root_identity,
        })
        expected = bridge.dispatch({
            "id": "2", "op": "stat_preview", "rootHandleId": opened["handleId"],
            "rootId": "root:test", "generation": "g:1", "components": ["race-chunk.txt"],
        })
        original_open = os.open
        original_fstat = os.fstat
        target_fd: int | None = None
        target_fstats = 0
        rewrote = False

        def track_open(path: object, flags: int, *args: object, **kwargs: object) -> int:
            nonlocal target_fd
            fd = original_open(path, flags, *args, **kwargs)
            if path == "race-chunk.txt" and kwargs.get("dir_fd") is not None:
                target_fd = fd
            return fd

        def rewrite_after_fd_snapshot(fd: int) -> os.stat_result:
            nonlocal target_fstats, rewrote
            if fd == target_fd:
                target_fstats += 1
                result = original_fstat(fd)
                if target_fstats == 2:
                    with target.open("r+b") as writer:
                        self.assertEqual(writer.write(b"after!"), 6)
                        writer.flush()
                    os.utime(
                        target,
                        ns=(result.st_atime_ns, max(result.st_mtime_ns + 3_000_000_000,
                                                    time.time_ns() + 3_000_000_000)),
                    )
                    rewrote = True
                    return result
                return result
            return original_fstat(fd)

        try:
            with patch.object(os, "open", side_effect=track_open), \
                 patch.object(os, "fstat", side_effect=rewrite_after_fd_snapshot):
                with self.assertRaisesRegex(BRIDGE_MODULE.ProtocolError, "identity_changed"):
                    bridge.dispatch({
                        "id": "3", "op": "read_preview_chunk", "rootHandleId": opened["handleId"],
                        "rootId": "root:test", "generation": "g:1", "components": ["race-chunk.txt"],
                        "expectedStat": expected, "offset": 0, "length": 6,
                    })
            self.assertTrue(rewrote)
            self.assertEqual(target.stat().st_size, 6)
            self.assertEqual(target.read_bytes(), b"after!")
        finally:
            bridge.close_all()

    def test_preview_detects_final_name_swap_during_read(self) -> None:
        target = self.root / "race.txt"
        target.write_text("before")
        bridge = BRIDGE_MODULE.DescriptorBridge()
        opened = bridge.dispatch({
            "id": "1", "op": "open_root", "path": str(self.root), "identity": self.root_identity,
        })
        expected = bridge.dispatch({
            "id": "2", "op": "stat_preview", "rootHandleId": opened["handleId"],
            "rootId": "root:test", "generation": "g:1", "components": ["race.txt"],
        })
        original_pread = os.pread

        def replace_after_read(fd: int, count: int, offset: int) -> bytes:
            data = original_pread(fd, count, offset)
            target.rename(self.root / "old.txt")
            target.write_text("after!")
            return data

        try:
            with patch.object(os, "pread", side_effect=replace_after_read):
                with self.assertRaises(BRIDGE_MODULE.ProtocolError):
                    bridge.dispatch({
                        "id": "3", "op": "read_preview_chunk", "rootHandleId": opened["handleId"],
                        "rootId": "root:test", "generation": "g:1", "components": ["race.txt"],
                        "expectedStat": expected, "offset": 0, "length": 6,
                    })
        finally:
            bridge.close_all()

    def test_preview_detects_parent_swap_and_closes_temporary_descriptors(self) -> None:
        parent = self.root / "nested"
        parent.mkdir()
        target = parent / "race.txt"
        target.write_text("same bytes")
        bridge = BRIDGE_MODULE.DescriptorBridge()
        opened = bridge.dispatch({
            "id": "1", "op": "open_root", "path": str(self.root), "identity": self.root_identity,
        })
        components = ["nested", "race.txt"]
        expected = bridge.dispatch({
            "id": "2", "op": "stat_preview", "rootHandleId": opened["handleId"],
            "rootId": "root:test", "generation": "g:1", "components": components,
        })
        original_pread = os.pread
        original_open = os.open
        original_close = os.close
        opened_fds: list[int] = []
        closed_fds: list[int] = []

        def track_open(*args: object, **kwargs: object) -> int:
            fd = original_open(*args, **kwargs)
            opened_fds.append(fd)
            return fd

        def track_close(fd: int) -> None:
            closed_fds.append(fd)
            original_close(fd)

        def replace_parent_after_read(fd: int, count: int, offset: int) -> bytes:
            data = original_pread(fd, count, offset)
            parent.rename(self.root / "old-nested")
            parent.mkdir()
            (parent / "race.txt").write_text("same bytes")
            return data

        try:
            with patch.object(os, "open", side_effect=track_open), \
                 patch.object(os, "close", side_effect=track_close), \
                 patch.object(os, "pread", side_effect=replace_parent_after_read):
                with self.assertRaises(BRIDGE_MODULE.ProtocolError):
                    bridge.dispatch({
                        "id": "3", "op": "read_preview_chunk", "rootHandleId": opened["handleId"],
                        "rootId": "root:test", "generation": "g:1", "components": components,
                        "expectedStat": expected, "offset": 0, "length": 10,
                    })
                self.assertTrue(set(opened_fds).issubset(set(closed_fds)))
        finally:
            bridge.close_all()

    def test_child_rename_is_detected_after_open(self) -> None:
        child_path = self.root / "child"
        child_path.mkdir()
        root_id = self.open_root()
        child_stat = self.bridge.call("lstat_child", parentHandleId=root_id, name="child")
        child = self.bridge.call("open_child", parentHandleId=root_id, name="child")
        child_path.rename(self.root / "renamed")
        child_path.mkdir()
        self.assertNotEqual(identity(child_path), child_stat["identity"])
        self.assertFalse(
            self.bridge.call(
                "verify_child",
                parentHandleId=root_id,
                name="child",
                identity=child["identity"],
            )
        )

    def test_handle_close_and_eof_release_descriptors(self) -> None:
        root_id = self.open_root()
        handle = self.bridge.call("open_child", parentHandleId=root_id, name=self._directory())
        self.bridge.call("read", handleId=handle["handleId"])
        self.bridge.call("close", handleId=handle["handleId"])
        with self.assertRaises(BridgeCallError):
            self.bridge.call("read", handleId=handle["handleId"])
        self.assertEqual(self.bridge.close(), 0)
        self.bridge = None

    def _directory(self) -> str:
        name = "empty"
        (self.root / name).mkdir()
        return name

    def test_protocol_rejects_unsafe_names_unknown_commands_and_oversized_lines(self) -> None:
        root_id = self.open_root()
        with self.assertRaises(BridgeCallError):
            self.bridge.call("lstat_child", parentHandleId=root_id, name="../outside")
        with self.assertRaises(BridgeCallError):
            self.bridge.call("execute", command="cat", path="secret")

        assert self.bridge.process.stdin
        self.bridge.process.stdin.write(b"x" * (64 * 1024 + 1) + b"\n")
        self.bridge.process.stdin.flush()
        self.assertEqual(self.bridge.close(), 64)
        self.bridge = None

    def test_open_directory_iterator_does_not_own_handle_fd(self) -> None:
        root_id = self.open_root()
        # Exhausting scandir must not invalidate the separately managed handle.
        while self.bridge.call("read", handleId=root_id) is not None:
            pass
        self.assertTrue(
            self.bridge.call(
                "verify_root", path=str(self.root), identity=self.root_identity, handleId=root_id
            )
        )

    def test_explicit_filesystem_root_can_be_opened_without_enumerating_it(self) -> None:
        self.assertEqual(BRIDGE_MODULE.validate_path("/"), ("/", []))
        root_fd = BRIDGE_MODULE.DescriptorBridge()._open_directory_path("/")
        os.close(root_fd)
        try:
            root_identity = self.bridge.call("capture_root_identity", path="/")
        except BridgeCallError as error:
            self.assertEqual(str(error), "unsupported_identity_provider")
            return
        result = self.bridge.call("open_root", path="/", identity=root_identity)
        self.assertEqual(result["identity"], identity(Path("/")))
        self.bridge.call("close", handleId=result["handleId"])


class NativeRootIdentityProviderTests(unittest.TestCase):
    def test_unknown_linux_filesystem_fails_closed_before_generation_ioctl(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dobius-identity-provider-") as path:
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                provider = BRIDGE_MODULE._native_identity_module
                with patch.object(provider, "_linux_filesystem_type", return_value=0x12345678):
                    with self.assertRaises(provider.NativeRootIdentityError) as error:
                        provider._linux_root_identity(fd, os.fstat(fd))
                self.assertEqual(error.exception.args, ("unsupported_identity_provider",))
            finally:
                os.close(fd)


if __name__ == "__main__":
    unittest.main()
