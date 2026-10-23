"""Focused synthetic-bundle tests for the packaged artifact manifest."""
import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("bundle-manifest.py")
SPEC = importlib.util.spec_from_file_location("bundle_manifest", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
manifest = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manifest)


def make_asar(
    *, catalog_capability: bool = True, main_chunks: dict[str, bytes] | None = None,
    bad_main_offset: bool = False, malformed_nested_main: bool = False
) -> bytes:
    """Build the smallest valid archive containing every required ASAR entry."""
    root: dict[str, object] = {"files": {}}
    chunks: list[bytes] = []
    offset = 0

    def add(entry_path: str, content: bytes, *, bad_offset: bool = False) -> None:
        nonlocal offset
        node = root
        for part in entry_path.split("/")[:-1]:
            files = node["files"]
            assert isinstance(files, dict)
            node = files.setdefault(part, {"files": {}})
            assert isinstance(node, dict)
        files = node["files"]
        assert isinstance(files, dict)
        entry_offset = "999999999" if bad_offset else str(offset)
        files[entry_path.split("/")[-1]] = {"size": len(content), "offset": entry_offset}
        chunks.append(content)
        offset += len(content)

    for entry_path, _step in manifest.ASAR_ENTRIES:
        content = b"x"
        if entry_path == "out/main/index.js":
            content = (
                b"data.catalog.roots data.catalog.page"
                if catalog_capability
                else b"legacy main entry"
            )
        add(entry_path, content, bad_offset=bad_main_offset and entry_path == "out/main/index.js")
    for entry_path, content in (main_chunks or {}).items():
        add("out/main/" + entry_path, content)
    if malformed_nested_main:
        main_files = root["files"]["out"]["files"]["main"]["files"]
        assert isinstance(main_files, dict)
        main_files["unexpected-directory"] = {"files": []}

    json_header = json.dumps(root, separators=(",", ":")).encode()
    padded_header = json_header + b"\0" * ((-len(json_header)) % 4)
    header_pickle = struct.pack("<II", 4 + len(padded_header), len(json_header)) + padded_header
    size_pickle = struct.pack("<II", 4, len(header_pickle))
    return size_pickle + header_pickle + b"".join(chunks)


def make_asar_with_header_root(root: object) -> bytes:
    json_header = json.dumps(root, separators=(",", ":")).encode("utf-8")
    padded_header = json_header + b"\0" * ((-len(json_header)) % 4)
    header_pickle = struct.pack("<II", 4 + len(padded_header), len(json_header)) + padded_header
    return struct.pack("<II", 4, len(header_pickle)) + header_pickle


def make_bundle(root: Path) -> Path:
    bundle = root / "Dobius+.app"
    (bundle / "Contents/Resources").mkdir(parents=True)
    (bundle / "Contents/Resources/app.asar").write_bytes(make_asar())

    for relative_path, _step in manifest.DISK_FILES:
        if "Electron Framework.framework" in relative_path:
            continue
        path = bundle / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fixture")

    for relative_path, _step in manifest.CATALOG_HELPER_FILES:
        path = bundle / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fixture helper")

    for relative_path, _step in manifest.DISK_EXECUTABLES:
        path = bundle / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fixture executable")
        path.chmod(0o755)

    # Match the real Electron framework layout: both framework paths checked
    # by the manifest traverse legitimate symlinks into Versions/A.
    framework = bundle / "Contents/Frameworks/Electron Framework.framework"
    version_a = framework / "Versions/A"
    version_a.mkdir(parents=True)
    (version_a / "Electron Framework").write_bytes(b"framework")
    signature = version_a / "_CodeSignature/CodeResources"
    signature.parent.mkdir()
    signature.write_bytes(b"signature")
    (framework / "Versions/Current").symlink_to("A", target_is_directory=True)
    (framework / "Electron Framework").symlink_to("Versions/Current/Electron Framework")
    return bundle


class BundleManifestCatalogResourceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.bundle = make_bundle(Path(self.temp_dir.name))

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_complete_bundle_passes_and_framework_symlinks_are_accepted(self) -> None:
        framework_entry = (
            self.bundle
            / "Contents/Frameworks/Electron Framework.framework/Electron Framework"
        )
        self.assertTrue(framework_entry.is_symlink())
        self.assertEqual(manifest.missing_artifacts(str(self.bundle)), [])

    def test_each_catalog_helper_is_required(self) -> None:
        for relative_path, _step in manifest.CATALOG_HELPER_FILES:
            with self.subTest(relative_path=relative_path):
                (self.bundle / relative_path).unlink()
                missing = manifest.missing_artifacts(str(self.bundle))
                self.assertEqual(len(missing), 1)
                self.assertIn(relative_path, missing[0])
                # Restore for the next helper's independent absence check.
                (self.bundle / relative_path).write_bytes(b"fixture helper")

    def test_catalog_enabled_bundle_without_either_helper_is_rejected(self) -> None:
        for relative_path, _step in manifest.CATALOG_HELPER_FILES:
            (self.bundle / relative_path).unlink()

        missing = manifest.missing_artifacts(str(self.bundle))

        self.assertEqual(len(missing), 2)
        for relative_path, _step in manifest.CATALOG_HELPER_FILES:
            self.assertTrue(any(relative_path in item for item in missing))

    def test_each_empty_catalog_helper_is_rejected(self) -> None:
        for relative_path, _step in manifest.CATALOG_HELPER_FILES:
            with self.subTest(relative_path=relative_path):
                (self.bundle / relative_path).write_bytes(b"")
                missing = manifest.missing_artifacts(str(self.bundle))
                self.assertEqual(len(missing), 1)
                self.assertIn(relative_path, missing[0])
                self.assertIn("non-empty readable regular file", missing[0])
                (self.bundle / relative_path).write_bytes(b"fixture helper")

    def test_each_unreadable_catalog_helper_is_rejected(self) -> None:
        # The descriptor API may still open mode-000 files when tests run as
        # root, so inject the effective open failure for each exact resource.
        for relative_path, _step in manifest.CATALOG_HELPER_FILES:
            with self.subTest(relative_path=relative_path):
                real_open = manifest.resource_contract._open_regular_beneath

                def open_resource(root: str, rel: str):
                    if Path(root) == self.bundle and rel == relative_path:
                        raise PermissionError("fixture unreadable helper")
                    return real_open(root, rel)

                with patch.object(
                    manifest.resource_contract,
                    "_open_regular_beneath",
                    side_effect=open_resource,
                ):
                    missing = manifest.missing_artifacts(str(self.bundle))
                self.assertEqual(len(missing), 1)
                self.assertIn(relative_path, missing[0])
                self.assertIn("readable regular file", missing[0])

    def test_catalog_helper_symlink_to_external_file_is_rejected(self) -> None:
        relative_path, _step = manifest.CATALOG_HELPER_FILES[0]
        helper = self.bundle / relative_path
        external_helper = Path(self.temp_dir.name) / "outside-helper.py"
        external_helper.write_bytes(b"external helper content")
        helper.unlink()
        helper.symlink_to(external_helper)

        missing = manifest.missing_artifacts(str(self.bundle))

        self.assertEqual(len(missing), 1)
        self.assertIn(relative_path, missing[0])
        self.assertIn("readable regular file", missing[0])

    def test_catalog_helper_parent_symlink_to_external_directory_is_rejected(self) -> None:
        relative_path, _step = manifest.CATALOG_HELPER_FILES[0]
        helper_parent = self.bundle / "Contents/Resources/data-catalog"
        outside = Path(self.temp_dir.name) / "outside-data-catalog"
        outside.mkdir()
        for name, _ in manifest.CATALOG_HELPER_FILES:
            (outside / Path(name).name).write_bytes(b"external helper")
        for child in helper_parent.iterdir():
            child.unlink()
        helper_parent.rmdir()
        helper_parent.symlink_to(outside, target_is_directory=True)

        missing = manifest.missing_artifacts(str(self.bundle))

        self.assertEqual(len(missing), 2)
        self.assertTrue(any(relative_path in item for item in missing))
        self.assertTrue(all("unsafe parent directories" in item for item in missing))

    def test_legacy_bundle_without_catalog_rpc_or_helpers_remains_eligible(self) -> None:
        asar = self.bundle / "Contents/Resources/app.asar"
        asar.write_bytes(make_asar(catalog_capability=False))
        for relative_path, _step in manifest.CATALOG_HELPER_FILES:
            (self.bundle / relative_path).unlink()

        self.assertEqual(manifest.missing_artifacts(str(self.bundle)), [])

    def test_catalog_capability_in_main_chunk_requires_both_helpers(self) -> None:
        asar = self.bundle / "Contents/Resources/app.asar"
        asar.write_bytes(
            make_asar(
                catalog_capability=False,
                main_chunks={"chunks/catalog.js": b"export const method='data.catalog.page'"},
            )
        )
        for relative_path, _step in manifest.CATALOG_HELPER_FILES:
            (self.bundle / relative_path).unlink()

        missing = manifest.missing_artifacts(str(self.bundle))

        self.assertEqual(len(missing), 2)
        self.assertTrue(all("readable regular file" in item for item in missing))

    def test_catalog_capability_in_unpacked_main_chunk_requires_both_helpers(self) -> None:
        asar = self.bundle / "Contents/Resources/app.asar"
        asar.write_bytes(make_asar(catalog_capability=False))
        unpacked_chunk = (
            self.bundle
            / "Contents/Resources/app.asar.unpacked/out/main/chunks/catalog.js"
        )
        unpacked_chunk.parent.mkdir(parents=True)
        unpacked_chunk.write_text("data.catalog.roots", encoding="utf-8")
        for relative_path, _step in manifest.CATALOG_HELPER_FILES:
            (self.bundle / relative_path).unlink()

        missing = manifest.missing_artifacts(str(self.bundle))

        self.assertEqual(len(missing), 2)

    def test_symlinked_unpacked_main_parent_fails_closed(self) -> None:
        resources = self.bundle / "Contents/Resources"
        asar = resources / "app.asar"
        asar.write_bytes(make_asar(catalog_capability=False))
        unpacked = resources / "app.asar.unpacked"
        unpacked.mkdir(exist_ok=True)
        existing_main = unpacked / "out/main"
        (existing_main / "daemon-entry.js").unlink()
        existing_main.rmdir()
        outside = Path(self.temp_dir.name) / "outside-main"
        (outside / "main").mkdir(parents=True)
        (outside / "main/chunk.js").write_text("data.catalog.page", encoding="utf-8")
        (unpacked / "out/main").symlink_to(outside / "main", target_is_directory=True)

        missing = manifest.missing_artifacts(str(self.bundle))

        self.assertTrue(any("catalog capability could not be inspected" in item for item in missing))

    def test_malformed_main_entry_and_oversized_inspection_fail_closed(self) -> None:
        asar_path = self.bundle / "Contents/Resources/app.asar"
        asar_path.write_bytes(make_asar(catalog_capability=False, bad_main_offset=True))
        malformed = manifest.missing_artifacts(str(self.bundle))
        self.assertTrue(any("catalog capability could not be inspected" in item for item in malformed))

        asar_path.write_bytes(make_asar(catalog_capability=False))
        with patch.object(manifest.resource_contract, "MAX_MAIN_JS_TOTAL_BYTES", 1):
            oversized = manifest.missing_artifacts(str(self.bundle))
        self.assertTrue(any("catalog capability could not be inspected" in item for item in oversized))

    def test_oversized_asar_header_is_rejected_before_reading_it(self) -> None:
        with patch.object(manifest.resource_contract, "MAX_ASAR_HEADER_BYTES", 64):
            missing = manifest.missing_artifacts(str(self.bundle))
        self.assertTrue(any("app.asar is not a readable asar archive" in item for item in missing))

    def test_malformed_root_and_nested_main_headers_never_bypass_manifest_checks(self) -> None:
        malformed_roots = (
            None,
            7,
            "root",
            [],
            {},
            {"files": []},
            {"files": {"out": {"files": {"main": []}}}},
        )
        asar_path = self.bundle / "Contents/Resources/app.asar"
        for malformed_root in malformed_roots:
            with self.subTest(root=malformed_root):
                asar_path.write_bytes(make_asar_with_header_root(malformed_root))
                missing = manifest.missing_artifacts(str(self.bundle))
                self.assertTrue(missing)
                self.assertTrue(any("app.asar" in item for item in missing))

    def test_malformed_nested_main_graph_fails_closed_with_all_required_entries_present(self) -> None:
        asar_path = self.bundle / "Contents/Resources/app.asar"
        asar_path.write_bytes(make_asar(malformed_nested_main=True))

        missing = manifest.missing_artifacts(str(self.bundle))

        self.assertTrue(any("catalog capability could not be inspected" in item for item in missing))

    def test_manifest_closes_the_pinned_asar_descriptor_after_nested_validation_error(self) -> None:
        asar_path = self.bundle / "Contents/Resources/app.asar"
        asar_path.write_bytes(make_asar(malformed_nested_main=True))
        real_open = manifest.resource_contract.os.open
        real_close = manifest.resource_contract.os.close
        opened: set[int] = set()
        closed: set[int] = set()

        def tracked_open(path, flags, *args, **kwargs):
            descriptor = real_open(path, flags, *args, **kwargs)
            opened.add(descriptor)
            return descriptor

        def tracked_close(descriptor):
            closed.add(descriptor)
            return real_close(descriptor)

        with patch.object(manifest.resource_contract.os, "open", side_effect=tracked_open), patch.object(
            manifest.resource_contract.os, "close", side_effect=tracked_close
        ):
            missing = manifest.missing_artifacts(str(self.bundle))
        self.assertTrue(any("catalog capability could not be inspected" in item for item in missing))
        self.assertEqual(opened, closed)

    def test_manifest_closes_the_pinned_asar_descriptor_after_success(self) -> None:
        real_open = manifest.resource_contract.os.open
        real_close = manifest.resource_contract.os.close
        opened: set[int] = set()
        closed: set[int] = set()

        def tracked_open(path, flags, *args, **kwargs):
            descriptor = real_open(path, flags, *args, **kwargs)
            opened.add(descriptor)
            return descriptor

        def tracked_close(descriptor):
            closed.add(descriptor)
            return real_close(descriptor)

        with patch.object(manifest.resource_contract.os, "open", side_effect=tracked_open), patch.object(
            manifest.resource_contract.os, "close", side_effect=tracked_close
        ):
            self.assertEqual(manifest.missing_artifacts(str(self.bundle)), [])
        self.assertEqual(opened, closed)


if __name__ == "__main__":
    unittest.main()
