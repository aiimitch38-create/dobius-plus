#!/usr/bin/env python3
"""Securely configure one machine's dedicated S3 backup repository."""
import argparse
import fcntl
import getpass
import json
import os
import re
from pathlib import Path

from backup_config import atomic_json, read_json, validate
from backup_runner import tick
from restic_process import BackupFailure, run_restic


def activate(config):
    environment = validate(config)
    descriptor = os.open(Path(config["state_directory"]) / "job.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            run_restic(config, environment, ["snapshots", "--json"])
        except BackupFailure:
            # Existing repositories with a different key are refused by init.
            run_restic(config, environment, ["init"])
    return tick(config, force=True, notify=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--configure-only", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", args.bucket):
        raise SystemExit("Enter an existing private S3 bucket name.")
    if not re.fullmatch(r"[a-z]{2}-[a-z]+-\d", args.region):
        raise SystemExit("Enter an AWS region such as us-east-1.")
    config = read_json(args.config)
    if not config.get("profile"):
        raise SystemExit("Run the schedule installer first.")
    access_key = getpass.getpass("AWS backup access key ID (hidden): ").strip()
    secret_key = getpass.getpass("AWS backup secret access key (hidden): ").strip()
    session_token = getpass.getpass("AWS session token, if applicable (hidden; otherwise Enter): ").strip()
    if not access_key or not secret_key:
        raise SystemExit("No credentials saved: both key fields are required.")
    atomic_json(config["credentials_file"], {"access_key_id": access_key, "secret_access_key": secret_key, "session_token": session_token})
    config["region"] = args.region
    config["repository"] = f"s3:https://s3.{args.region}.amazonaws.com/{args.bucket}/{config['profile']}"
    atomic_json(args.config, config)
    print("S3 destination saved.")
    print("Save the recovery-password file in your password manager before relying on this backup.")
    print("Temporary AWS credentials require automatic refresh before they expire; this setup does not refresh them.")
    if not args.configure_only:
        result = activate(config)
        print(json.dumps(result, indent=2))
        if result["health"] not in ["healthy", "already_running"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
