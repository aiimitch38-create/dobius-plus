"""Race and graph-budget regressions for bundle-resource-contract.py."""
import importlib.util
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


CONTRACT_PATH = Path(__file__).with_name("bundle-resource-contract.py")
SPEC = importlib.util.spec_from_file_location("bundle_resource_contract_tested", CONTRACT_PATH)
assert SPEC is not None and SPEC.loader is not None
contract = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(contract)


def _make_asar(main_source):
    root = {"files": {"out": {"files": {"main": {"files": {
        "index.js": {"size": len(main_source), "offset": "0"}
    }}}}}}
    json_header = json.dumps(root, separators=(",", ":")).encode("utf-8")
    padded_header = json_header + b"\0" * ((-len(json_header)) % 4)
    pickle_header = struct.pack("<II", 4 + len(padded_header), len(json_header)) + padded_header
    size_header = struct.pack("<II", 4, len(pickle_header))
    return size_header + pickle_header + main_source


def _wrap_header(root):
    json_header = json.dumps(root, separators=(",", ":")).encode("utf-8")
    padded_header = json_header + b"\0" * ((-len(json_header)) % 4)
    pickle_header = struct.pack("<II", 4 + len(padded_header), len(json_header)) + padded_header
    return struct.pack("<II", 4, len(pickle_header)) + pickle_header


class BundleResourceContractTests(unittest.TestCase):
    def test_malformed_root_headers_are_rejected_and_close_the_asar_descriptor(self):
        malformed_roots = (None, 7, "root", [], {}, {"files": []})
        for malformed_root in malformed_roots:
            with self.subTest(root=malformed_root), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                archive = root / "Contents/Resources/app.asar"
                archive.parent.mkdir(parents=True)
                archive.write_bytes(_wrap_header(malformed_root))
                real_open, real_close = contract.os.open, contract.os.close
                opened, closed = set(), set()

                def tracked_open(path, flags, *args, **kwargs):
                    descriptor = real_open(path, flags, *args, **kwargs)
                    opened.add(descriptor)
                    return descriptor

                def tracked_close(descriptor):
                    closed.add(descriptor)
                    return real_close(descriptor)

                with patch.object(contract.os, "open", side_effect=tracked_open), patch.object(
                    contract.os, "close", side_effect=tracked_close
                ):
                    with self.assertRaisesRegex(ValueError, "malformed asar root header"):
                        contract.read_asar_header(root)
                self.assertEqual(opened, closed)

    @unittest.skipUnless(hasattr(os, "mkfifo") and hasattr(os, "O_NONBLOCK"), "FIFO support required")
    def test_fifo_resources_and_asar_fail_promptly_without_leaking_descriptors(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            helper_directory = root / "Contents/Resources/data-catalog"
            helper_directory.mkdir(parents=True)
            os.mkfifo(helper_directory / "bridge.py")
            resources = root / "Contents/Resources"
            os.mkfifo(resources / "app.asar")
            script = r'''
import importlib.util, os, sys
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("contract", sys.argv[1])
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)
real_open, real_close = os.open, os.close
opened, closed = set(), set()
def tracked_open(path, flags, *args, **kwargs):
    fd = real_open(path, flags, *args, **kwargs)
    opened.add(fd)
    if path in ("bridge.py", "app.asar"):
        assert flags & os.O_NONBLOCK
    return fd
def tracked_close(fd):
    closed.add(fd)
    return real_close(fd)
with patch.object(os, "open", side_effect=tracked_open), patch.object(os, "close", side_effect=tracked_close):
    assert contract.regular_resource_status(sys.argv[2], "Contents/Resources/data-catalog/bridge.py") == (True, False)
    assert contract.read_regular_beneath(sys.argv[2], "Contents/Resources/data-catalog/bridge.py", 1024) is None
    try:
        contract.read_asar_header(sys.argv[2])
    except (OSError, ValueError):
        pass
    else:
        raise AssertionError("FIFO app.asar was accepted")
assert opened == closed, (opened, closed)
print("FIFO_DESCRIPTOR_CHECK_OK")
'''
            result = subprocess.run(
                [sys.executable, "-c", script, str(CONTRACT_PATH), str(root)],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("FIFO_DESCRIPTOR_CHECK_OK", result.stdout)

    def test_asar_payload_uses_the_header_pinned_descriptor_after_path_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            resources = root / "Contents/Resources"
            resources.mkdir(parents=True)
            archive_path = resources / "app.asar"
            archive_path.write_bytes(_make_asar(b"legacy source"))
            header, data_offset, archive_size, descriptor, identity = contract.read_asar_header(root)
            try:
                resources.rename(root / "replaced-resources")
                resources.mkdir()
                archive_path.write_bytes(_make_asar(b"data.catalog.page"))
                enabled, error = contract.catalog_capability(
                    root, header, data_offset, archive_size, descriptor, identity
                )
                self.assertIsNone(error)
                self.assertFalse(enabled)
            finally:
                os.close(descriptor)

    def test_parent_swap_after_directory_open_reads_pinned_original_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent = root / "data-catalog"
            parent.mkdir()
            inside = parent / "bridge.py"
            inside.write_bytes(b"inside")
            outside = root / "outside"
            outside.mkdir()
            (outside / "bridge.py").write_bytes(b"outsiD")
            moved = root / "pinned-original"
            real_open = contract.os.open
            swapped = False

            def swap_before_final_open(path, flags, mode=0o777, *, dir_fd=None):
                nonlocal swapped
                if path == "bridge.py" and dir_fd is not None and not swapped:
                    parent.rename(moved)
                    parent.symlink_to(outside, target_is_directory=True)
                    swapped = True
                if dir_fd is None:
                    return real_open(path, flags, mode)
                return real_open(path, flags, mode, dir_fd=dir_fd)

            try:
                with patch.object(contract.os, "open", side_effect=swap_before_final_open):
                    payload = contract.read_regular_beneath(root, "data-catalog/bridge.py", 32)
                self.assertTrue(swapped)
                self.assertEqual(payload, b"inside")
            finally:
                if parent.is_symlink():
                    parent.unlink()
                if moved.exists():
                    moved.rename(parent)

    def test_parent_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outside = root / "outside"
            outside.mkdir()
            (outside / "bridge.py").write_bytes(b"external")
            (root / "data-catalog").symlink_to(outside, target_is_directory=True)

            self.assertIsNone(
                contract.read_regular_beneath(root, "data-catalog/bridge.py", 32)
            )
            self.assertEqual(
                contract.regular_resource_status(root, "data-catalog/bridge.py"),
                (True, False),
            )

    def test_every_main_graph_entry_counts_toward_the_node_budget(self):
        graph = {
            "files": {
                f"asset-{index}.txt": {"size": 1, "offset": "0"}
                for index in range(5)
            }
        }
        with patch.object(contract, "MAX_MAIN_GRAPH_NODES", 3):
            with self.assertRaisesRegex(ValueError, "oversized out/main graph"):
                contract._main_js_entries(graph)

    def test_directory_and_javascript_entries_share_one_graph_budget(self):
        graph = {
            "files": {
                "chunks": {
                    "files": {
                        "bundle.js": {"size": 1, "offset": "0"},
                        "asset.txt": {"size": 1, "offset": "1"},
                    }
                },
                "metadata.json": {"size": 1, "offset": "2"},
            }
        }
        with patch.object(contract, "MAX_MAIN_GRAPH_NODES", 4):
            with self.assertRaisesRegex(ValueError, "oversized out/main graph"):
                contract._main_js_entries(graph)


if __name__ == "__main__":
    unittest.main()
