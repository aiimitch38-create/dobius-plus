"""Recovery, failure, and scheduler regressions for the real backup workflow."""
import fcntl
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import backup_runner
from backup_config import ConfigurationError, atomic_json, read_json, validate
from configure_destination import activate
from install_schedule import create_config
from restic_process import BackupFailure, restore_canary, run_restic


class BackupRegressionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.state = self.base / "state"
        self.state.mkdir()
        self.password = self.base / "password"
        self.password.write_text("test-only-encryption-password\n")
        self.password.chmod(0o600)
        (self.state / "restore-canary.txt").write_text("recover this exact content\n")
        self.source = self.base / "source"
        self.source.mkdir()
        self.executable = self.base / "restic"
        self.executable.write_text("#!/bin/sh\nexit 0\n")
        self.executable.chmod(0o700)
        self.config = {"version": 1, "profile": "test", "state_directory": str(self.state), "repository": str(self.base / "repository"), "test_local_repository": True, "restic_binary": str(self.executable), "password_file": str(self.password), "sources": [{"path": str(self.source), "required": True}]}

    def test_unconfigured_destination_never_reports_success(self):
        self.config["repository"] = None
        result = backup_runner.tick(self.config, notify=False)
        self.assertEqual(result["health"], "waiting_for_configuration")
        self.assertNotIn("last_backup_at", result)

    def test_missing_required_source_stops_backup_and_retention(self):
        self.config["sources"][0]["path"] = str(self.base / "missing")
        with patch("backup_runner.run_restic") as run:
            result = backup_runner.tick(self.config, notify=False)
        self.assertEqual(result["health"], "waiting_for_configuration")
        run.assert_not_called()

    def test_credential_symlink_and_broad_permissions_are_rejected(self):
        self.password.chmod(0o644)
        with self.assertRaises(ConfigurationError):
            validate(self.config)
        self.password.chmod(0o600)
        alias = self.base / "password-link"
        alias.symlink_to(self.password)
        self.config["password_file"] = str(alias)
        with self.assertRaises(ConfigurationError):
            validate(self.config)

    def test_partial_snapshot_exit_three_is_failure(self):
        self.executable.write_text('#!/bin/sh\nprintf \'{"message_type":"summary","snapshot_id":"partial"}\\n\'\nexit 3\n')
        result = backup_runner.tick(self.config, notify=False)
        self.assertEqual(result["health"], "failed")
        self.assertIn("code 3", result["detail"])
        self.assertNotIn("last_backup_at", result)

    def test_overlapping_jobs_do_not_start_another_backup(self):
        with (self.state / "job.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch("backup_runner.run_restic") as run:
                result = backup_runner.tick(self.config, notify=False)
            self.assertEqual(result["health"], "already_running")
            run.assert_not_called()

    def test_command_timeout_does_not_unlock_repository(self):
        self.executable.write_text("#!/bin/sh\nsleep 20\n")
        self.config["command_timeout_seconds"] = 0.1
        with self.assertRaisesRegex(BackupFailure, "time limit"):
            run_restic(self.config, validate(self.config), ["backup"])

    def test_failure_diagnostics_redact_aws_and_recovery_secrets(self):
        self.executable.write_text('#!/bin/sh\nprintf "%s\\n" "$AWS_SECRET_ACCESS_KEY"\ncat "$RESTIC_PASSWORD_FILE"\nexit 1\n')
        environment = validate(self.config)
        environment["AWS_SECRET_ACCESS_KEY"] = "sensitive-aws-test-key"
        with self.assertRaises(BackupFailure) as failure:
            run_restic(self.config, environment, ["snapshots"])
        self.assertNotIn("sensitive-aws-test-key", str(failure.exception))
        self.assertNotIn("test-only-encryption-password", str(failure.exception))
        self.assertIn("[redacted]", str(failure.exception))

    def test_corrupt_restored_file_is_rejected(self):
        original = self.state / "restore-canary.txt"

        def corrupt(config, environment, arguments):
            target = Path(arguments[arguments.index("--target") + 1])
            destination = target / str(original).lstrip("/")
            destination.parent.mkdir(parents=True)
            destination.write_text("corrupted")

        with patch("restic_process.run_restic", side_effect=corrupt):
            with self.assertRaisesRegex(BackupFailure, "does not match"):
                restore_canary(self.config, validate(self.config), "snapshot")

    def test_restore_failure_prevents_retention_and_healthy_status(self):
        commands = []

        def command(config, environment, arguments):
            commands.append(arguments[0])
            return {"snapshot_id": "abc"} if arguments[0] == "backup" else None

        with patch("backup_runner.run_restic", side_effect=command), patch("backup_runner.restore_canary", side_effect=BackupFailure("restore rejected")):
            result = backup_runner.tick(self.config, notify=False)
        self.assertEqual(result["health"], "failed")
        self.assertNotIn("forget", commands)
        self.assertNotIn("last_backup_at", result)

    def test_initial_integrity_check_reads_all_data(self):
        commands = []

        def command(config, environment, arguments):
            commands.append(arguments)
            return {"snapshot_id": "abc"} if arguments[0] == "backup" else None

        with patch("backup_runner.run_restic", side_effect=command), patch("backup_runner.restore_canary"):
            result = backup_runner.tick(self.config, notify=False)
        self.assertEqual(result["health"], "healthy")
        self.assertIn(["check", "--read-data"], commands)
        self.assertTrue(any("--keep-monthly" in c for c in commands))

    def test_scheduler_tick_does_not_repeat_a_recent_success(self):
        import time
        atomic_json(self.state / "status.json", {"health": "healthy", "last_backup_epoch": time.time()})
        with patch("backup_runner.run_restic") as run:
            result = backup_runner.tick(self.config, notify=False)
        self.assertEqual(result["health"], "healthy")
        run.assert_not_called()

    def test_reinstall_preserves_configuration_and_encryption_key(self):
        base = self.base / "installation"
        base.mkdir()
        configuration = create_config(base, "vps", self.source, self.executable)
        before_key = (base / "secrets/restic-password").read_bytes()
        before_config = configuration.read_bytes()
        self.assertEqual(create_config(base, "vps", self.source, self.executable), configuration)
        self.assertEqual((base / "secrets/restic-password").read_bytes(), before_key)
        self.assertEqual(configuration.read_bytes(), before_config)
        self.assertEqual((base / "secrets/recovery-password").read_bytes(), before_key)


@unittest.skipUnless(os.environ.get("DOBIUS_TEST_RESTIC"), "Set DOBIUS_TEST_RESTIC for real encrypted backup and restore tests")
class RealResticRecoveryTests(unittest.TestCase):
    setUp = BackupRegressionTests.setUp

    def test_encrypted_versioned_restore_preserves_uncommitted_work_and_git(self):
        self.config["restic_binary"] = os.environ["DOBIUS_TEST_RESTIC"]
        self.config["exclude_patterns"] = ["**/node_modules"]
        pending = self.source / "unfinished.txt"
        pending.write_text("committed baseline\n")
        subprocess.run(["git", "init", "--initial-branch=main", str(self.source)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.source), "add", "unfinished.txt"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.source), "-c", "user.name=Backup Test", "-c", "user.email=backup-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "Recovery baseline"], check=True, capture_output=True)
        committed_head = subprocess.check_output(["git", "-C", str(self.source), "rev-parse", "HEAD"], text=True).strip()
        pending.write_text("unfinished version one\n")
        (self.source / "untracked.txt").write_text("new work not in Git\n")
        dependencies = self.source / "node_modules"
        dependencies.mkdir()
        (dependencies / "regenerable.txt").write_text("do not back up\n")
        environment = validate(self.config)
        run_restic(self.config, environment, ["init"])
        first = backup_runner.tick(self.config, force=True, notify=False)
        self.assertEqual(first["health"], "healthy", first)
        pending.write_text("unfinished version two\n")
        second = backup_runner.tick(self.config, force=True, notify=False)
        self.assertEqual(second["health"], "healthy", second)
        self.assertNotEqual(first["last_snapshot"], second["last_snapshot"])
        target = self.base / "restored"
        run_restic(self.config, environment, ["restore", first["last_snapshot"], "--target", str(target), "--verify"])
        restored_source = target / str(self.source).lstrip("/")
        self.assertEqual((restored_source / "unfinished.txt").read_text(), "unfinished version one\n")
        self.assertEqual((restored_source / ".git/HEAD").read_text(), "ref: refs/heads/main\n")
        self.assertEqual((restored_source / "untracked.txt").read_text(), "new work not in Git\n")
        recovered_head = subprocess.check_output(["git", "-C", str(restored_source), "rev-parse", "HEAD"], text=True).strip()
        self.assertEqual(recovered_head, committed_head)
        self.assertEqual(subprocess.check_output(["git", "-C", str(restored_source), "show", "HEAD:unfinished.txt"], text=True), "committed baseline\n")
        self.assertFalse((restored_source / "node_modules").exists())
        self.assertIn("last_restore_at", second)
        # Exit failure with the wrong key proves this is an encrypted repository.
        self.password.write_text("wrong-key\n")
        with self.assertRaises(BackupFailure):
            run_restic(self.config, validate(self.config), ["snapshots"])
        with self.assertRaises(BackupFailure):
            activate(self.config)
        self.password.write_text("test-only-encryption-password\n")
        run_restic(self.config, validate(self.config), ["snapshots"])


if __name__ == "__main__":
    unittest.main()
