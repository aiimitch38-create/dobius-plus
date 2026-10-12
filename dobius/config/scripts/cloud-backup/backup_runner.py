#!/usr/bin/env python3
"""Run scheduled, versioned backups without starting Dobius or its workers."""
import argparse
import fcntl
import json
import os
import platform
import subprocess
import time
from pathlib import Path

from backup_config import ConfigurationError, atomic_json, backup_sources, read_json, timestamp, validate
from restic_process import BackupFailure, restore_canary, run_restic


def notification(old, new):
    if old.get("health") == new.get("health") and old.get("detail") == new.get("detail"):
        return
    if new["health"] == "healthy":
        return
    if platform.system() == "Darwin":
        message = "Dobius cloud backup needs attention. Open its backup status for details."
        subprocess.run(["/usr/bin/osascript", "-e", 'display notification "' + message + '" with title "Dobius Backup"'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)


def save_status(config, previous, state, notify):
    state["checked_at"] = timestamp()
    atomic_json(Path(config["state_directory"]) / "status.json", state)
    if notify:
        try:
            notification(previous, state)
        except (OSError, subprocess.TimeoutExpired):
            pass


def tick(config, force=False, notify=True):
    state_directory = Path(config["state_directory"])
    state_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state_directory.is_symlink() or state_directory.stat().st_uid != os.getuid():
        raise ConfigurationError("Backup state directory must be owned by this user and not a symlink.")
    os.chmod(state_directory, 0o700)
    lock_descriptor = os.open(state_directory / "job.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_descriptor, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"health": "already_running"}
        previous = read_json(state_directory / "status.json")
        state = dict(previous)
        state["profile"] = config.get("profile", "unknown")
        try:
            environment = validate(config)
            sources = backup_sources(config)
        except (ConfigurationError, KeyError, ValueError) as error:
            state.update(health="waiting_for_configuration", detail=str(error))
            save_status(config, previous, state, notify)
            return state
        now = time.time()
        if not force and now - state.get("last_backup_epoch", 0) < config.get("backup_interval_seconds", 1800):
            save_status(config, previous, state, notify=False)
            return state
        try:
            state.update(health="running", detail="Creating an encrypted backup snapshot.")
            save_status(config, previous, state, notify=False)
            command = ["backup", "--json", "--host", config["profile"], "--tag", "dobius-automatic", "--read-concurrency", "1"]
            for pattern in config.get("exclude_patterns", []):
                command += ["--exclude", pattern]
            command += ["--", *sources]
            summary = run_restic(config, environment, command)
            snapshot = summary.get("snapshot_id")
            if not snapshot:
                raise BackupFailure("Completed backup did not identify its snapshot.")
            state.update(last_snapshot=snapshot, last_uploaded_at=timestamp())
            if now - state.get("last_check_epoch", 0) >= 7 * 86400:
                full = "last_full_check_epoch" not in state or now - state["last_full_check_epoch"] >= 30 * 86400
                args = ["check", "--read-data"] if full else ["check", "--read-data-subset=5%"]
                run_restic(config, environment, args)
                state.update(last_check_epoch=now, last_check_at=timestamp())
                if full:
                    state["last_full_check_epoch"] = now
            if now - state.get("last_restore_epoch", 0) >= 7 * 86400:
                restore_canary(config, environment, snapshot)
                state.update(last_restore_epoch=now, last_restore_at=timestamp())
            if now - state.get("last_retention_epoch", 0) >= 86400:
                run_restic(config, environment, ["forget", "--host", config["profile"], "--tag", "dobius-automatic", "--group-by", "host", "--keep-daily", "30", "--keep-weekly", "12", "--keep-monthly", "12", "--prune"])
                state.update(last_retention_epoch=now, last_retention_at=timestamp())
            state.update(health="healthy", detail="Encrypted snapshot completed; restore and integrity checks are current.", last_backup_epoch=now, last_backup_at=timestamp())
            save_status(config, previous, state, notify)
            return state
        except (BackupFailure, OSError) as error:
            state.update(health="failed", detail=str(error), last_failure_at=timestamp())
            save_status(config, previous, state, notify)
            return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("action", choices=["tick", "run", "status", "init"])
    parser.add_argument("--no-notify", action="store_true")
    args = parser.parse_args()
    config = read_json(args.config)
    if args.action == "status":
        state = read_json(Path(config["state_directory"]) / "status.json")
        print(json.dumps(state, indent=2))
        return 0
    if args.action == "init":
        environment = validate(config)
        run_restic(config, environment, ["init"])
        print("Encrypted backup repository initialized. Run the first backup and verify its status.")
        return 0
    result = tick(config, force=args.action == "run", notify=not args.no_notify)
    print(json.dumps(result, indent=2))
    return 0 if result["health"] in ["healthy", "already_running"] else 78 if result["health"] == "waiting_for_configuration" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ConfigurationError, BackupFailure, OSError, KeyError, ValueError) as error:
        print("Backup could not run: " + str(error))
        raise SystemExit(1)
