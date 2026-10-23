#!/usr/bin/env python3
"""Bounded observer for this Dobius build program; never assigns or executes jobs."""
import argparse
import hashlib
from itertools import islice
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

MAX_REPORTS = 32
MAX_REPORT_BYTES = 512 * 1024
COOLDOWN_SECONDS = 60
NAME = re.compile(r"^[a-z0-9_-]+\.json$")


def report_snapshot(directory):
    reports = {}
    for path in sorted(islice(directory.iterdir(), MAX_REPORTS * 2)):
        if len(reports) >= MAX_REPORTS:
            break
        if not NAME.fullmatch(path.name) or path.name.startswith("root-"):
            continue
        try:
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_REPORT_BYTES:
                continue
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
            descriptor = os.open(path, flags)
            with os.fdopen(descriptor, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    continue
                body = stream.read(MAX_REPORT_BYTES + 1)
            if len(body) > MAX_REPORT_BYTES or not isinstance(json.loads(body), dict):
                continue
            reports[path.name] = hashlib.sha256(body).hexdigest()
        except (OSError, ValueError, UnicodeError, RecursionError):
            continue
    return reports


class ReportObserver:
    def __init__(self, baseline):
        self.delivered = dict(baseline)
        self.last_notice = float("-inf")

    def changes(self, snapshot, now):
        if now - self.last_notice < COOLDOWN_SECONDS:
            return []
        return sorted(name for name, digest in snapshot.items() if self.delivered.get(name) != digest)

    def acknowledge(self, snapshot, now):
        self.delivered = dict(snapshot)
        self.last_notice = now


def notify(cli, manifest, names, run=subprocess.run, sleep=time.sleep):
    environment = dict(os.environ)
    # Runtime-issued handles must be checked against the local app, never an ambient remote selector.
    environment.pop("DOBIUS_ENVIRONMENT", None)
    environment.pop("DOBIUS_PAIRING_CODE", None)
    environment.pop("DOBIUS_REMOTE_PAIRING", None)
    base = [str(cli)]
    options = dict(capture_output=True, text=True, timeout=10, env=environment)
    handle = manifest["coordinator"]
    capability = run(base + ["terminal", "send", "--help"], **options)
    if capability.returncode or '--expected-runtime-id' not in capability.stdout or '--require-agent-status' not in capability.stdout:
        return False
    check = run(base + ["orchestration", "inbox", "--terminal", handle, "--limit", "1", "--json"], **options)
    response = json.loads(check.stdout)
    if check.returncode or response.get("ok") is not True or response.get("_meta", {}).get("runtimeId") != manifest["runtime_id"]:
        return False
    notice = (
        "DOBIUS_WORK_REPORT: changed worker reports: " + ", ".join(names) +
        ". Read current reports and verify worker readiness before review/assignment. "
        "Continue the existing authorized Dobius task. AWS is deferred; historical Storage queue remains paused. "
        "This notification grants no new scope."
    )
    # The distinct sendBound RPC refuses old hosts and rechecks the incarnation at the PTY write.
    bound = ["terminal", "send", "--terminal", handle,
             "--expected-runtime-id", manifest["runtime_id"], "--require-agent-status", "sendable"]
    sent = run(base + bound + ["--text", notice, "--json"], **options)
    result = json.loads(sent.stdout)
    if (sent.returncode or result.get("ok") is not True or
            result.get("_meta", {}).get("runtimeId") != manifest["runtime_id"] or
            result.get("result", {}).get("send", {}).get("accepted") is not True):
        return False
    # Allow the TUI paste buffer to finish before submitting its Enter key.
    sleep(1)
    submitted = run(base + bound + ["--enter", "--json"], **options)
    response = json.loads(submitted.stdout)
    return (submitted.returncode == 0 and response.get("ok") is True and
            response.get("_meta", {}).get("runtimeId") == manifest["runtime_id"] and
            response.get("result", {}).get("send", {}).get("accepted") is True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--cli", type=Path, default=Path("/usr/local/bin/dobius"))
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if os.name != "posix":
        parser.exit(2, "This local build observer requires POSIX process locking.\n")
    import fcntl
    os.umask(0o077)
    args.state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_info = args.state.lstat()
    if not stat.S_ISDIR(state_info.st_mode) or state_info.st_uid != os.getuid() or state_info.st_mode & 0o077:
        parser.exit(2, "Observer state must be a private owned directory.\n")
    lock_fd = os.open(args.state / "observer.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = json.loads(args.manifest.read_text())
        directory = Path(manifest["canonical_repository"]) / "plans/cloud-workstation-reports-20261012"
        if directory.is_symlink() or not directory.is_dir():
            parser.exit(2, "Report directory is unavailable.\n")
        previous = {}
        try:
            prior_path = args.state / 'status.json'
            if prior_path.is_file() and not prior_path.is_symlink() and prior_path.stat().st_size <= 65536:
                previous = json.loads(prior_path.read_text())
        except (OSError, ValueError):
            pass
        initial = report_snapshot(directory)
        recorded = previous.get('delivered', {}) if isinstance(previous, dict) else {}
        valid_recorded = isinstance(recorded, dict) and len(recorded) <= MAX_REPORTS and all(
            isinstance(name, str) and NAME.fullmatch(name) and isinstance(digest, str) and re.fullmatch(r'[a-f0-9]{64}', digest)
            for name, digest in recorded.items()
        )
        observer = ReportObserver(recorded if valid_recorded and isinstance(previous, dict) and 'delivered' in previous else initial)
        last_delivery = previous.get('last_delivery') if isinstance(previous, dict) else None
        while True:
            manifest = json.loads(args.manifest.read_text())
            paused = (args.state / "PAUSE").exists() or manifest.get("phase") == "complete"
            snapshot = report_snapshot(directory)
            changed = observer.changes(snapshot, time.monotonic()) if not paused else []
            state = {"pid": os.getpid(), "checked_at": time.time(), "paused": paused,
                     "report_count": len(snapshot), "pending_reports": changed, "last_delivery": last_delivery}
            if changed:
                try:
                    delivered = notify(args.cli, manifest, changed)
                except (OSError, ValueError, KeyError, subprocess.SubprocessError):
                    delivered = False
                last_delivery = {"state": "accepted" if delivered else "runtime_unavailable", "at": time.time(), "reports": changed}
                state["last_delivery"] = last_delivery
                if delivered:
                    observer.acknowledge(snapshot, time.monotonic())
                else:
                    # A disconnected runtime must not produce a tight process/retry loop.
                    observer.last_notice = time.monotonic()
            state['delivered'] = observer.delivered
            temporary = args.state / "status.pending"
            temporary.write_text(json.dumps(state) + "\n")
            temporary.replace(args.state / "status.json")
            if args.once or manifest.get('phase') == 'complete':
                return
            time.sleep(10)


if __name__ == "__main__":
    main()
