#!/usr/bin/env python3
"""Source-tree state of a Dobius+ checkout, as one JSON object (BUILD-044).

Usage: source-state.py <any path inside the checkout>
       source-state.py --from-build-record <BUILD-PROVENANCE.json>

Prints {repo, branch, commit, dirty, diffDigest, tag}. With --from-build-record
it validates a record written at build time and prints its source state (exit 3
when the record is unreadable or malformed). Used at build time by
dobius/config/scripts/electron-builder-with-build-number.mjs (the record ships
inside the bundle) and, only for a bundle without that record, by the gated
installer. One implementation, so a build-time and an install-time digest of
the same tree are identical.

A value that cannot be determined is null ("unknown" for repo/branch/commit,
matching the installer's historical provenance), never a guess.
"""
import hashlib
import json
import os
import re
import subprocess
import sys


def git(repo, *args):
    # --no-optional-locks: reading status must never take index.lock from a
    # build or install running beside another git operation.
    return subprocess.run(
        ["git", "--no-optional-locks", "-C", repo, *args], capture_output=True, check=True
    ).stdout


def sha256_file(file_path):
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def diff_digest(repo):
    # Tracked changes (staged + unstaged) as one binary diff, then every
    # untracked, non-ignored path with a hash of its content.
    digest = hashlib.sha256(
        git(repo, "diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv", "--no-color")
    )
    untracked = git(repo, "ls-files", "--others", "--exclude-standard", "-z").split(b"\0")
    for rel in sorted(p for p in untracked if p):
        full = os.path.join(repo, os.fsdecode(rel))
        if os.path.islink(full):
            content = b"link:" + os.fsencode(os.readlink(full))
        elif os.path.isfile(full):
            content = sha256_file(full).encode()
        else:
            content = b"other"
        digest.update(b"\0untracked\0" + rel + b"\0" + content)
    return "sha256:" + digest.hexdigest()


def source_state(start):
    state = {
        "repo": "unknown",
        "branch": "unknown",
        "commit": "unknown",
        "dirty": None,
        "diffDigest": None,
        "tag": None,
    }
    try:
        repo = git(start, "rev-parse", "--show-toplevel").decode().strip()
    except (OSError, subprocess.CalledProcessError):
        return state
    state["repo"] = repo
    try:
        state["branch"] = git(repo, "branch", "--show-current").decode().strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    try:
        state["commit"] = git(repo, "rev-parse", "--short", "HEAD").decode().strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    try:
        dirty = bool(git(repo, "status", "--porcelain", "--untracked-files=all").strip())
        state["diffDigest"] = diff_digest(repo) if dirty else None
        state["dirty"] = dirty
    except (OSError, subprocess.CalledProcessError):
        state["dirty"] = state["diffDigest"] = None
    try:
        # Annotated tags only: the release-tag contract (#110) is `git tag -a v<version>`.
        state["tag"] = git(repo, "describe", "--exact-match", "HEAD").decode().strip() or None
    except (OSError, subprocess.CalledProcessError):
        pass
    return state


def from_build_record(record_path):
    with open(record_path, encoding="utf-8") as handle:
        record = json.load(handle)
    if not isinstance(record, dict):
        raise ValueError("not an object")
    for key in ("repo", "branch", "commit"):
        if not isinstance(record.get(key), str):
            raise ValueError(key)
    dirty, digest, tag = record.get("dirty"), record.get("diffDigest"), record.get("tag")
    if not (dirty is None or isinstance(dirty, bool)):
        raise ValueError("dirty")
    if dirty is True and not (isinstance(digest, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", digest)):
        raise ValueError("diffDigest")
    if dirty is not True and digest is not None:
        raise ValueError("diffDigest")
    if tag is not None and not isinstance(tag, str):
        raise ValueError("tag")
    return {key: record[key] for key in ("repo", "branch", "commit")} | {
        "dirty": dirty,
        "diffDigest": digest,
        "tag": tag,
    }


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--from-build-record":
        try:
            state = from_build_record(sys.argv[2])
        except (OSError, ValueError) as error:
            sys.stderr.write("invalid build record: %s\n" % error)
            sys.exit(3)
    elif len(sys.argv) == 2:
        state = source_state(sys.argv[1])
    else:
        sys.stderr.write(__doc__)
        sys.exit(64)
    json.dump(state, sys.stdout)
    sys.stdout.write("\n")
