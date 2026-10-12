#!/usr/bin/env python3
"""Install verified restic and an automatic Mac or Linux backup schedule."""
import argparse
import bz2
import hashlib
import json
import os
import platform
import plistlib
import secrets
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen

from backup_config import atomic_json, read_json


VERSION = "0.19.1"
MODULES = ["backup_config.py", "restic_process.py", "backup_runner.py", "configure_destination.py", "install_schedule.py", "settings_bridge.py"]
EXCLUDES = ["**/node_modules", "**/.pnpm-store", "**/dist", "**/out", "**/build", "**/.next", "**/.turbo", "**/Pods", "**/DerivedData", "**/.venv", "**/.cache", "**/.DS_Store", "**/GPUCache", "**/Code Cache", "**/Cache", "**/__pycache__"]


def download(url):
    if shutil.which("curl"):
        # Native curl uses the platform trust store, including managed Mac CAs.
        result = subprocess.run(["curl", "--fail", "--location", "--proto", "=https", "--proto-redir", "=https", "--max-time", "60", "--silent", "--show-error", url], capture_output=True, check=True, timeout=65)
        return result.stdout
    request = Request(url, headers={"User-Agent": "Dobius-Backup-Installer"})
    with urlopen(request, timeout=60) as response:
        return response.read(64 * 1024 * 1024)


def install_restic(base):
    executable = base / "bin/restic"
    installation = read_json(base / "restic-installation.json")
    if executable.is_file() and not executable.is_symlink() and installation.get("version") == VERSION and installation.get("binary_sha256") == hashlib.sha256(executable.read_bytes()).hexdigest():
        return executable
    architecture = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "amd64"}.get(platform.machine())
    operating_system = {"Darwin": "darwin", "Linux": "linux"}.get(platform.system())
    if not architecture or not operating_system:
        raise RuntimeError("This installer supports macOS and Linux on ARM64 or x86_64.")
    asset = f"restic_{VERSION}_{operating_system}_{architecture}.bz2"
    release = f"https://github.com/restic/restic/releases/download/v{VERSION}/"
    checksums = download(release + "SHA256SUMS").decode()
    expected = next(line.split()[0] for line in checksums.splitlines() if line.split()[-1].lstrip("*") == asset)
    compressed = download(release + asset)
    actual = hashlib.sha256(compressed).hexdigest()
    if actual != expected:
        raise RuntimeError("Official restic download did not match its published SHA-256.")
    executable.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = executable.with_suffix(".new")
    temporary.write_bytes(bz2.decompress(compressed))
    os.chmod(temporary, 0o700)
    subprocess.run([str(temporary), "version"], check=True)
    temporary.replace(executable)
    atomic_json(base / "restic-installation.json", {"version": VERSION, "asset": asset, "compressed_sha256": actual, "binary_sha256": hashlib.sha256(executable.read_bytes()).hexdigest(), "source": release})
    return executable


def source_paths(profile, base, repository):
    home = Path.home()
    if profile == "laptop":
        paths = [(repository, True), (home / "Obsidian Vault", True), (home / "Library/Application Support/dobius-orchestration-monitor", True), (home / "Library/Caches/dobius-dmg-review-worktree-20261009", False), (home / "Documents", False), (home / "Desktop", False)]
        application_support = home / "Library/Application Support"
        if application_support.exists():
            paths += [(p, False) for p in application_support.iterdir() if p.is_dir() and "dobius" in p.name.lower() and p != base and p.name != "dobius-orchestration-monitor"]
    else:
        paths = [(Path("/opt/dobius-build"), True), (Path("/opt/dobius"), True), (Path("/root/vault"), True), (Path("/home/dobius"), True), (Path("/srv/dobius/workspaces"), False)]
    return [{"path": str(p), "required": required} for p, required in paths]


def create_config(base, profile, repository, executable):
    configuration = base / "config.json"
    if configuration.exists():
        return configuration
    state = base / "state"
    state.mkdir(mode=0o700, exist_ok=True)
    secret_directory = base / "secrets"
    secret_directory.mkdir(mode=0o700, exist_ok=True)
    for name in ["restic-password", "recovery-password"]:
        destination = secret_directory / name
        if not destination.exists():
            if name == "restic-password":
                value = secrets.token_urlsafe(48) + "\n"
            else:
                value = (secret_directory / "restic-password").read_text()
            descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, "w") as stream:
                stream.write(value)
    canary = state / "restore-canary.txt"
    if not canary.exists():
        canary.write_text("Dobius restore verification: " + secrets.token_hex(32) + "\n")
        os.chmod(canary, 0o600)
    atomic_json(configuration, {"version": 1, "profile": profile, "repository": None, "region": "us-east-1", "restic_binary": str(executable), "state_directory": str(state), "password_file": str(secret_directory / "restic-password"), "credentials_file": str(secret_directory / "aws.json"), "backup_interval_seconds": 1800, "command_timeout_seconds": 7200, "sources": source_paths(profile, base, repository), "exclude_patterns": EXCLUDES})
    return configuration


def install_launch_agent(base, python, config):
    target = Path.home() / "Library/LaunchAgents/com.verlosolutions.dobius.cloud-backup.plist"
    if target.exists():
        previous = plistlib.loads(target.read_bytes())
        if previous.get("ProgramArguments", [None, None])[1] != str(base / "code/backup_runner.py"):
            raise RuntimeError("Existing launch agent is owned by another installation.")
        subprocess.run(["/bin/launchctl", "bootout", f"gui/{os.getuid()}", str(target)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    target.parent.mkdir(parents=True, exist_ok=True)
    document = {"Label": "com.verlosolutions.dobius.cloud-backup", "ProgramArguments": [str(python), str(base / "code/backup_runner.py"), "--config", str(config), "tick"], "RunAtLoad": True, "StartInterval": 1800, "Nice": 10, "LowPriorityIO": True, "ProcessType": "Background", "StandardOutPath": str(base / "state/scheduler.stdout.log"), "StandardErrorPath": str(base / "state/scheduler.stderr.log")}
    target.write_bytes(plistlib.dumps(document))
    os.chmod(target, 0o600)
    for name in ["scheduler.stdout.log", "scheduler.stderr.log"]:
        p = base / "state" / name
        p.touch(mode=0o600, exist_ok=True)
        os.chmod(p, 0o600)
    subprocess.run(["/bin/launchctl", "bootstrap", f"gui/{os.getuid()}", str(target)], check=True)
    return target


def install_systemd(base, python, config):
    if os.getuid() != 0:
        raise RuntimeError("Installing the VPS system timer requires root.")
    command = [str(python), str(base / "code/backup_runner.py"), "--config", str(config), "tick", "--no-notify"]
    escaped = " ".join('"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"' for value in command)
    service = "[Unit]\nDescription=Dobius encrypted cloud backup\nWants=network-online.target\nAfter=network-online.target\n\n[Service]\nType=oneshot\nExecStart=" + escaped + "\nUMask=0077\nNice=10\nIOSchedulingClass=idle\nTimeoutStartSec=8h\nSuccessExitStatus=78\n"
    timer = "[Unit]\nDescription=Back up Dobius every 30 minutes\n\n[Timer]\nOnCalendar=*:0/30\nPersistent=true\nRandomizedDelaySec=30\nUnit=dobius-cloud-backup.service\n\n[Install]\nWantedBy=timers.target\n"
    target = Path("/etc/systemd/system/dobius-cloud-backup.service")
    if target.exists() and str(base / "code/backup_runner.py") not in target.read_text():
        raise RuntimeError("Existing backup service belongs to another installation.")
    target.write_text(service)
    Path("/etc/systemd/system/dobius-cloud-backup.timer").write_text(timer)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", "dobius-cloud-backup.timer"], check=True)
    subprocess.run(["systemctl", "start", "dobius-cloud-backup.service"], check=True)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=["laptop", "vps"], required=True)
    parser.add_argument("--base", type=Path)
    parser.add_argument("--repository", type=Path, default=Path("/Users/bayou/Projects (Code)/Dobius/dobius-plus"))
    parser.add_argument("--no-schedule", action="store_true")
    args = parser.parse_args()
    base = args.base or (Path.home() / "Library/Application Support/Dobius Cloud Backup" if args.profile == "laptop" else Path("/opt/dobius-cloud-backup"))
    if not base.is_absolute() or base.is_symlink():
        raise RuntimeError("Installation path must be absolute and not a symlink.")
    base.mkdir(mode=0o700, parents=True, exist_ok=True)
    if base.stat().st_uid != os.getuid():
        raise RuntimeError("Installation directory must be owned by this user.")
    os.chmod(base, 0o700)
    executable = install_restic(base)
    code = base / "code"
    code.mkdir(mode=0o700, exist_ok=True)
    for module in MODULES:
        shutil.copyfile(Path(__file__).parent / module, code / module)
        os.chmod(code / module, 0o600)
    config = create_config(base, args.profile, args.repository, executable)
    target = None
    if not args.no_schedule:
        target = install_launch_agent(base, Path(sys.executable), config) if platform.system() == "Darwin" else install_systemd(base, Path(sys.executable), config)
    print(json.dumps({"installed": str(base), "config": str(config), "schedule": str(target) if target else None, "cloud_status": "Awaiting S3 destination and credentials; no backup success claimed."}, indent=2))


if __name__ == "__main__":
    main()
