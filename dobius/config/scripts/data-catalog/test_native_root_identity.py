"""Focused tests for read-only native root-incarnation providers."""

from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("native-root-identity.py")
SPEC = importlib.util.spec_from_file_location("native_root_identity_test", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class NativeRootIdentityTests(unittest.TestCase):
    def test_supported_provider_returns_canonical_same_descriptor_identity(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dobius-native-id-") as root:
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                before = os.fstat(fd)
                identity = native.root_identity_from_fd(fd)
                after = os.fstat(fd)
            finally:
                os.close(fd)

        self.assertEqual(identity["dev"], str(before.st_dev))
        self.assertEqual(identity["ino"], str(before.st_ino))
        incarnation = identity["incarnation"]
        self.assertGreater(int(incarnation["token"]), 0)
        self.assertEqual(incarnation["token"], str(int(incarnation["token"])))
        if os.sys.platform == "darwin":
            self.assertEqual(incarnation["provider"], "darwin-apfs-file-id-v1")
            self.assertRegex(incarnation["scope"], r"^[0-9a-f]{32}$")
            self.assertEqual(incarnation["token"], str(before.st_ino))
        else:
            self.assertEqual(incarnation["provider"], "linux-inode-generation-v1")
            self.assertRegex(incarnation["scope"], r"^[0-9a-f]{16}$")
            self.assertLessEqual(int(incarnation["token"]), 0xFFFFFFFF)
        self.assertEqual((before.st_dev, before.st_ino), (after.st_dev, after.st_ino))

    @unittest.skipUnless(os.sys.platform in ("darwin", "linux"), "provider OS only")
    def test_child_creation_does_not_change_root_incarnation(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dobius-native-id-child-") as root:
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                first = native.root_identity_from_fd(fd)
                Path(root, "ordinary-child").mkdir()
                second = native.root_identity_from_fd(fd)
            finally:
                os.close(fd)
        self.assertEqual(first, second)

    @unittest.skipUnless(os.sys.platform in ("darwin", "linux"), "provider OS only")
    def test_recreated_root_has_a_different_native_token(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dobius-native-id-replace-") as parent:
            root = Path(parent, "root")
            root.mkdir()
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                original = native.root_identity_from_fd(fd)
            finally:
                os.close(fd)
            root.rmdir()
            root.mkdir()
            replacement_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                replacement = native.root_identity_from_fd(replacement_fd)
            finally:
                os.close(replacement_fd)
        self.assertEqual(original["incarnation"]["provider"], replacement["incarnation"]["provider"])
        self.assertEqual(original["incarnation"]["scope"], replacement["incarnation"]["scope"])
        self.assertNotEqual(original["incarnation"]["token"], replacement["incarnation"]["token"])

    def test_linux_refuses_non_ext_filesystem_without_mutating_it(self) -> None:
        if os.sys.platform != "linux":
            self.skipTest("Linux provider only")
        with tempfile.TemporaryDirectory(prefix="dobius-native-id-unsupported-") as root:
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                with patch.object(native, "_linux_filesystem_type", return_value=0):
                    with self.assertRaises(native.NativeRootIdentityError):
                        native.root_identity_from_fd(fd)
            finally:
                os.close(fd)


if __name__ == "__main__":
    unittest.main()
