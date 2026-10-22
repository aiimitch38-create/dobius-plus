import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bridge_protocol import ProtocolError
from policy_manifest import REQUIRED_RUNTIME, verify_core_policy


class PolicyManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "hermes"
        self.root.mkdir()
        self.resources = Path(self.temp.name) / "resources"
        self.resources.mkdir()
        self.revision = patch("policy_manifest.current_revision", return_value="b" * 40)
        self.revision.start()
        self.manifest_path = self.resources / "manifest.json"
        entries = []
        for name in sorted(REQUIRED_RUNTIME):
            path = self.root / name
            path.parent.mkdir(exist_ok=True)
            path.write_text("# synthetic reviewed host policy code\n")
            entries.append({"path": name, "role": "runtime",
                            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        patch_file = self.resources / "core.patch"
        patch_file.write_text("synthetic maintained patch")
        self.manifest = {"version": 1, "hashAlgorithm": "sha256", "baseRevision": "b" * 40,
                         "files": entries,
                         "patch": {"path": "core.patch", "sha256": hashlib.sha256(patch_file.read_bytes()).hexdigest()}}
        self.save()

    def tearDown(self):
        self.revision.stop()
        self.temp.cleanup()

    def save(self):
        self.manifest_path.write_text(json.dumps(self.manifest))

    def test_exact_reviewed_runtime_passes(self):
        verify_core_policy(self.root, self.manifest_path)

    def test_partial_update_with_helper_still_present_is_refused(self):
        (self.root / "agent" / "tool_executor.py").write_text("# unpatched old executor\n")
        self.assertTrue((self.root / "agent" / "host_tool_policy.py").exists())
        with self.assertRaises(ProtocolError) as raised:
            verify_core_policy(self.root, self.manifest_path)
        self.assertEqual(raised.exception.code, "policy-unavailable")

    def test_new_hermes_revision_is_refused_even_with_unchanged_enforcement_sites(self):
        with patch("policy_manifest.current_revision", return_value="c" * 40):
            with self.assertRaises(ProtocolError):
                verify_core_policy(self.root, self.manifest_path)

    def test_missing_enforcement_site_is_refused_even_with_valid_remaining_hashes(self):
        self.manifest["files"] = self.manifest["files"][1:]
        self.save()
        with self.assertRaises(ProtocolError):
            verify_core_policy(self.root, self.manifest_path)

    def test_path_escape_and_symlink_are_refused(self):
        original = json.loads(json.dumps(self.manifest))
        for value in ("../outside", "/absolute", "agent/../tool_executor.py", "agent\\tool_executor.py"):
            self.manifest = json.loads(json.dumps(original))
            self.manifest["files"][0]["path"] = value
            self.save()
            with self.assertRaises(ProtocolError):
                verify_core_policy(self.root, self.manifest_path)
        self.manifest = original
        self.save()
        executor = self.root / "agent" / "tool_executor.py"
        executor.unlink()
        executor.symlink_to(self.root / "agent" / "host_tool_policy.py")
        with self.assertRaises(ProtocolError):
            verify_core_policy(self.root, self.manifest_path)

    def test_changed_patch_and_duplicate_entries_are_refused(self):
        self.manifest["files"].append(dict(self.manifest["files"][0]))
        self.save()
        with self.assertRaises(ProtocolError):
            verify_core_policy(self.root, self.manifest_path)
        self.manifest["files"].pop()
        self.save()
        (self.resources / "core.patch").write_text("changed patch")
        with self.assertRaises(ProtocolError):
            verify_core_policy(self.root, self.manifest_path)


if __name__ == "__main__":
    unittest.main()
