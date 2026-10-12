#!/usr/bin/env python3
"""Desktop settings control; credential input is only read from private stdin."""
import argparse
import fcntl
import json
import os
import platform
import re
import sys
import subprocess
import uuid
from pathlib import Path

from backup_config import ConfigurationError, atomic_json, backup_sources, read_json, timestamp, validate
from backup_runner import tick
from install_schedule import install_launch_agent, install_restic, install_systemd, create_config, MODULES
from restic_process import BackupFailure, run_restic


def validate_input(data):
    if not isinstance(data, dict):
        raise ConfigurationError("AWS connection details must be an object.")
    limits = {"bucket": 63, "region": 40, "accessKeyId": 128, "secretAccessKey": 256, "sessionToken": 16384}
    values = {}
    for name, limit in limits.items():
        value = data.get(name, "")
        if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ConfigurationError("AWS connection details contain an invalid field.")
        values[name] = value.strip()
    bucket = values["bucket"]
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket) or ".." in bucket or ".-" in bucket or "-." in bucket or re.fullmatch(r"\d+\.\d+\.\d+\.\d+", bucket):
        raise ConfigurationError("Enter an existing S3 bucket name, without a URL.")
    if not re.fullmatch(r"[a-z]{2}(-[a-z]+)+-\d", values["region"]) or values["region"].startswith("cn-"):
        raise ConfigurationError("Enter a supported AWS region, such as us-east-1.")
    if not values["accessKeyId"] or not values["secretAccessKey"]:
        raise ConfigurationError("Both AWS key fields are required.")
    return values


def prepare(base, data):
    import shutil
    base.mkdir(mode=0o700, parents=True, exist_ok=True)
    if base.is_symlink() or base.stat().st_uid != os.getuid():
        raise ConfigurationError("Backup directory must belong to this user and not be a symlink.")
    os.chmod(base, 0o700)
    executable = install_restic(base)
    code = base / "code"
    code.mkdir(mode=0o700, exist_ok=True)
    for name in MODULES:
        source = Path(__file__).parent / name
        target = code / name
        if source.resolve() != target.resolve():
            shutil.copyfile(source, target)
            target.chmod(0o600)
    config_path = base / "config.json"
    fresh = not config_path.exists()
    paths = data.get("sourcePaths", [])
    if not isinstance(paths, list) or any(not isinstance(p, str) or not Path(p).is_absolute() for p in paths):
        raise ConfigurationError("Backup sources must be absolute local paths.")
    create_config(base, "laptop" if platform.system() == "Darwin" else "vps", Path.home(), executable)
    config = read_json(config_path)
    config["configuration_file"] = str(config_path)
    if fresh:
        sources = [(Path(p), True) for p in paths]
        sources += [(Path.home() / n, False) for n in ["Obsidian Vault", "Documents", "Desktop"]]
        sources += [(Path(data["applicationDataPath"]), True)]
        deduplicated = {}
        for path, required in sources:
            deduplicated[str(path)] = required or deduplicated.get(str(path), False)
        config["sources"] = [{"path": p, "required": required} for p, required in deduplicated.items()]
    atomic_json(config_path, config)
    return config


def connect(base, data, config):
    values = validate_input(data)
    state_dir = Path(config["state_directory"])
    pending = base / "secrets" / ("aws.pending-" + uuid.uuid4().hex)
    atomic_json(pending, {"access_key_id": values["accessKeyId"], "secret_access_key": values["secretAccessKey"], "session_token": values["sessionToken"]})
    candidate = {**config, "region": values["region"], "repository": f"s3:https://s3.{values['region']}.amazonaws.com/{values['bucket']}/{config['profile']}", "credentials_file": str(pending), "enabled": True}
    descriptor = os.open(state_dir / "job.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ConfigurationError("A backup is already running. Wait for it to finish before connecting.")
            environment = validate(candidate)
            backup_sources(candidate)
            try:
                run_restic(candidate, environment, ["snapshots", "--json"])
            except BackupFailure:
                # Init refuses a repository encrypted with another key; it never replaces it.
                run_restic(candidate, environment, ["init"])
            pending.replace(config["credentials_file"])
            candidate["credentials_file"] = config["credentials_file"]
            atomic_json(base / "config.json", candidate)
            if config.get("repository") != candidate["repository"]:
                atomic_json(state_dir / "status.json", {"health": "connecting", "detail": "AWS connected. Preparing the first verified backup.", "pid": os.getpid(), "checked_at": timestamp()})
        if platform.system() == "Darwin":
            loaded = subprocess.run(["/bin/launchctl", "print", f"gui/{os.getuid()}/com.verlosolutions.dobius.cloud-backup"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            if loaded.returncode != 0:
                install_launch_agent(base, Path(sys.executable), base / "config.json")
        else:
            install_systemd(base, Path(sys.executable), base / "config.json")
        result = tick(candidate, force=True, notify=False)
        # A newly loaded schedule may own the lock already; its status remains authoritative.
        if result["health"] == "already_running":
            return read_json(state_dir / "status.json")
        return result
    finally:
        pending.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("action", choices=["connect", "run", "pause", "resume"])
    args = parser.parse_args()
    os.umask(0o077)
    data = json.loads(sys.stdin.read(32769) or "{}")
    if args.action == "connect":
        validate_input(data)
    base = args.base
    base.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not base.is_absolute() or base.is_symlink() or base.stat().st_uid != os.getuid():
        raise ConfigurationError("Backup directory is not a private local directory.")
    lock_fd = os.open(base / "settings.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        config_path = base / "config.json"
        config = read_json(config_path)
        if args.action in ["pause", "resume"]:
            if not config:
                raise ConfigurationError("Connect AWS before changing its schedule.")
            config["enabled"] = args.action == "resume"
            atomic_json(config_path, config)
            if args.action == "pause":
                return
        state_dir = base / "state"
        state_dir.mkdir(mode=0o700, exist_ok=True)
        previous = read_json(state_dir / "status.json")
        try:
            atomic_json(state_dir / "status.json", {**previous, "health": "connecting" if args.action == "connect" else "running", "detail": "Checking AWS and preparing automatic backups." if args.action == "connect" else "Starting an encrypted backup.", "pid": os.getpid(), "checked_at": timestamp()})
            if args.action == "connect":
                config = prepare(base, data)
                connect(base, data, config)
            else:
                if not config:
                    raise ConfigurationError("Connect AWS before starting a backup.")
                tick(config, force=True, notify=False)
        except (ConfigurationError, BackupFailure, OSError, ValueError, KeyError):
            # Only the Restic wrapper's redacted errors are safe to surface. Other
            # exceptions can contain process arguments or raw credential payloads.
            error = sys.exc_info()[1]
            detail = str(error) if isinstance(error, (ConfigurationError, BackupFailure)) else "AWS setup could not finish. Check the backup runtime and try again."
            atomic_json(state_dir / "status.json", {**previous, "health": "failed", "detail": detail, "checked_at": timestamp()})
            raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Unexpected tracebacks must never send user credentials to app logs.
        raise SystemExit(1)
