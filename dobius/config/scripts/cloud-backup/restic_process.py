"""Bounded restic execution; credentials never appear in argv or status files."""
import hashlib
import json
import os
import signal
import subprocess
import tempfile
from pathlib import Path


class BackupFailure(Exception):
    pass


def run_restic(config, environment, arguments):
    state = Path(config["state_directory"])
    cache = state / "cache"
    cache.mkdir(mode=0o700, exist_ok=True)
    command = [config["restic_binary"], "--cache-dir", str(cache), "--retry-lock", "30s", *arguments]
    # A private temporary spool bounds RAM even during large backups.
    with tempfile.TemporaryFile(dir=state) as output:
        process = subprocess.Popen(command, env=environment, stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True)
        try:
            code = process.wait(timeout=config.get("command_timeout_seconds", 7200))
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
            raise BackupFailure("Backup command exceeded its time limit; no forced repository unlock was attempted.")
        if code != 0:
            # Exit 3 is an incomplete snapshot; it must never count as success.
            output.seek(0, os.SEEK_END)
            output.seek(max(0, output.tell() - 4096))
            detail = output.read().decode("utf-8", errors="replace")
            values = [environment.get(key, "") for key in ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "RESTIC_PASSWORD"]]
            values.append(Path(config["password_file"]).read_text().strip())
            for value in values:
                if value:
                    detail = detail.replace(value, "[redacted]")
            raise BackupFailure("restic " + arguments[0] + " exited with code " + str(code) + ". " + detail[-2000:].strip())
        output.seek(0)
        if arguments[0] == "backup":
            for line in output:
                try:
                    message = json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    continue
                if message.get("message_type") == "summary":
                    return message
            raise BackupFailure("Backup returned no completed snapshot summary.")
        return None


def restore_canary(config, environment, snapshot):
    original = Path(config["state_directory"]) / "restore-canary.txt"
    with tempfile.TemporaryDirectory(prefix="restore-check-", dir=config["state_directory"]) as target:
        run_restic(config, environment, ["restore", snapshot, "--target", target, "--include", str(original), "--verify"])
        restored = Path(target) / str(original).lstrip("/")
        if not restored.is_file() or restored.is_symlink():
            raise BackupFailure("Restore verification did not recover the expected file.")
        if hashlib.sha256(restored.read_bytes()).digest() != hashlib.sha256(original.read_bytes()).digest():
            raise BackupFailure("Restored file does not match the original.")
