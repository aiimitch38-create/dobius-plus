"""Verify the reviewed Hermes enforcement graph before trusting that runtime."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess

from bridge_protocol import ProtocolError

REQUIRED_RUNTIME = frozenset({
    "agent/host_tool_policy.py", "agent/agent_init.py", "agent/agent_runtime_helpers.py",
    "agent/chat_completion_helpers.py", "agent/conversation_loop.py", "agent/tool_executor.py",
    "gateway/platform_registry.py", "gateway/run.py", "gateway/session.py", "run_agent.py",
})


def _read_file(path, limit):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= limit:
        raise ProtocolError("policy-unavailable")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as file:
        opened = os.fstat(file.fileno())
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise ProtocolError("policy-unavailable")
        data = file.read(limit + 1)
    if len(data) > limit:
        raise ProtocolError("policy-unavailable")
    return data


def _checked_path(root, relative):
    if (not isinstance(relative, str) or not relative or "\\" in relative
            or PurePosixPath(relative).is_absolute()
            or any(part in ("", ".", "..") for part in relative.split("/"))):
        raise ProtocolError("policy-unavailable")
    path = root
    for part in relative.split("/"):
        path = path / part
        if path.is_symlink():
            raise ProtocolError("policy-unavailable")
    if not path.resolve(strict=True).is_relative_to(root):
        raise ProtocolError("policy-unavailable")
    return path


def _verify_hash(path, expected, limit):
    if not isinstance(expected, str) or re.fullmatch(r"[0-9a-f]{64}", expected) is None:
        raise ProtocolError("policy-unavailable")
    if hashlib.sha256(_read_file(path, limit)).hexdigest() != expected:
        raise ProtocolError("policy-unavailable")


def current_revision(root):
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    environment.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
    result = subprocess.run(["git", "--no-optional-locks", "-C", str(root), "rev-parse", "HEAD"],
                            capture_output=True, timeout=5, check=True, env=environment)
    return result.stdout.decode("ascii").strip()


def verify_core_policy(hermes_root, manifest_path=None):
    try:
        root = Path(hermes_root).resolve(strict=True)
        manifest_path = Path(manifest_path) if manifest_path else Path(__file__).with_name(
            "hermes-core-policy-manifest.json")
        manifest = json.loads(_read_file(manifest_path, 128 * 1024))
        if (type(manifest.get("version")) is not int or manifest["version"] != 1
                or manifest.get("hashAlgorithm") != "sha256"):
            raise ProtocolError("policy-unavailable")
        revision = manifest.get("baseRevision")
        if (not isinstance(revision, str) or re.fullmatch(r"[0-9a-f]{40,64}", revision) is None
                or current_revision(root) != revision):
            raise ProtocolError("policy-unavailable")
        files = manifest["files"]
        if not isinstance(files, list) or not 10 <= len(files) <= 64:
            raise ProtocolError("policy-unavailable")
        names = set()
        runtime = set()
        for entry in files:
            name = entry["path"]
            if name in names or entry["role"] not in ("runtime", "test"):
                raise ProtocolError("policy-unavailable")
            names.add(name)
            if entry["role"] == "runtime":
                runtime.add(name)
            _verify_hash(_checked_path(root, name), entry["sha256"], 8 * 1024 * 1024)
        if runtime != REQUIRED_RUNTIME:
            raise ProtocolError("policy-unavailable")
        patch = manifest["patch"]
        _verify_hash(_checked_path(manifest_path.parent.resolve(), patch["path"]),
                     patch["sha256"], 8 * 1024 * 1024)
    except Exception:
        raise ProtocolError("policy-unavailable") from None
