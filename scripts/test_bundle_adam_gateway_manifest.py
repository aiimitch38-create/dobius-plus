"""Conditional Adam runtime-resource checks using synthetic signed-bundle layouts."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_bundle_manifest import make_asar, make_bundle, manifest


class BundleAdamGatewayManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.bundle = make_bundle(Path(self.temp.name))

    def tearDown(self):
        self.temp.cleanup()

    def resources(self):
        for relative_path, _step in manifest.ADAM_GATEWAY_FILES:
            path = self.bundle / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"synthetic runtime resource")

    def test_legacy_bundle_without_bridge_or_resources_still_passes(self):
        self.assertFalse((self.bundle / "Contents/Resources/adam-telegram").exists())
        self.assertEqual(manifest.missing_artifacts(str(self.bundle)), [])

    def test_compiled_bridge_in_index_chunk_or_unpacked_chunk_requires_all_assets(self):
        archive = self.bundle / "Contents/Resources/app.asar"
        for location in ("index", "chunk", "unpacked"):
            with self.subTest(location=location):
                chunks = {}
                if location == "index":
                    chunks = {"index.js": b"data.catalog.page bridge_runner.py"}
                elif location == "chunk":
                    chunks = {"chunks/adam.js": b"dobius_adam_telegram"}
                archive.write_bytes(make_asar(main_chunks=chunks))
                if location == "unpacked":
                    path = self.bundle / "Contents/Resources/app.asar.unpacked/out/main/chunks/adam.js"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"bridge_runner.py")
                missing = manifest.missing_artifacts(str(self.bundle))
                self.assertEqual(len(missing), 9)
                self.assertTrue(all("Adam gateway" in item for item in missing))

    def test_each_required_asset_is_checked_independently(self):
        self.resources()
        self.assertEqual(manifest.missing_artifacts(str(self.bundle)), [])
        for relative_path, _step in manifest.ADAM_GATEWAY_FILES:
            with self.subTest(path=relative_path):
                path = self.bundle / relative_path
                path.unlink()
                missing = manifest.missing_artifacts(str(self.bundle))
                self.assertEqual(len(missing), 1)
                self.assertIn(relative_path, missing[0])
                path.write_bytes(b"restored synthetic resource")

    def test_partial_or_empty_resource_tree_cannot_claim_legacy_status(self):
        directory = self.bundle / "Contents/Resources/adam-telegram"
        directory.mkdir()
        self.assertEqual(len(manifest.missing_artifacts(str(self.bundle))), 9)
        (directory / "README.md").write_text("partial release")
        self.assertEqual(len(manifest.missing_artifacts(str(self.bundle))), 9)
        (directory / "bridge_runner.py").write_text("partial runner")
        self.assertEqual(len(manifest.missing_artifacts(str(self.bundle))), 8)

    def test_empty_or_symlinked_asset_is_rejected(self):
        self.resources()
        path = self.bundle / manifest.ADAM_GATEWAY_FILES[0][0]
        path.write_bytes(b"")
        missing = manifest.missing_artifacts(str(self.bundle))
        self.assertEqual(len(missing), 1)
        self.assertIn("non-empty readable regular file", missing[0])
        outside = Path(self.temp.name) / "outside-runner.py"
        outside.write_bytes(b"outside runner")
        path.unlink()
        path.symlink_to(outside)
        missing = manifest.missing_artifacts(str(self.bundle))
        self.assertEqual(len(missing), 1)
        self.assertIn("symlinks", missing[0])

    def test_symlinked_resource_parent_is_rejected_even_without_compiled_capability(self):
        outside = Path(self.temp.name) / "outside-resources"
        outside.mkdir()
        for relative_path, _step in manifest.ADAM_GATEWAY_FILES:
            (outside / Path(relative_path).name).write_bytes(b"external resource")
        (self.bundle / "Contents/Resources/adam-telegram").symlink_to(outside, target_is_directory=True)
        missing = manifest.missing_artifacts(str(self.bundle))
        self.assertEqual(len(missing), 9)
        self.assertTrue(all("unsafe parent directories" in item for item in missing))

    def test_uninspectable_main_graph_fails_closed_for_adam_capability(self):
        with patch.object(manifest.resource_contract, "MAX_MAIN_JS_TOTAL_BYTES", 1):
            missing = manifest.missing_artifacts(str(self.bundle))
        self.assertTrue(any("Adam gateway capability could not be inspected" in item for item in missing))


if __name__ == "__main__":
    unittest.main()
