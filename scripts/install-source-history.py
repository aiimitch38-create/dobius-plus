#!/usr/bin/env python3
"""Refuse an upgrade whose source omits the installed release's committed history."""
import json
import re
import subprocess
import sys


def git(repo, *args):
    return subprocess.run(["git", "--no-optional-locks", "-C", repo, *args],
                          capture_output=True, text=True, timeout=15)


def check_history(candidate, installed, rollback=False):
    if rollback:
        # The installer verifies the exact rollback bundle's paired record before selecting this mode.
        return
    old = installed.get("commit")
    if old in (None, "", "unknown"):
        return  # Legacy/first installs have no committed baseline to compare.
    new, repo = candidate.get("commit"), candidate.get("repo")
    if not all(isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{7,64}", value)
               for value in (old, new)) or not isinstance(repo, str):
        raise ValueError("source commit information is missing or invalid")
    for commit in (old, new):
        if git(repo, "rev-parse", "--verify", commit + "^{commit}").returncode:
            raise ValueError("the candidate checkout cannot resolve the installed and candidate commits")
    result = git(repo, "merge-base", "--is-ancestor", old, new)
    if result.returncode:
        raise ValueError("candidate %s does not include installed release %s; merge the installed UI/release history first"
                         % (new, old))


if __name__ == "__main__":
    try:
        candidate = json.loads(sys.argv[1])
        with open(sys.argv[2], encoding="utf-8") as handle:
            installed = json.load(handle)
        check_history(candidate, installed, rollback=len(sys.argv) > 3 and sys.argv[3] == "rollback")
    except (OSError, ValueError, subprocess.SubprocessError, IndexError) as error:
        sys.stderr.write("REFUSED: source history guard: %s. --take-over does not bypass this guard.\n" % error)
        sys.exit(1)
