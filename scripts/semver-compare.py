#!/usr/bin/env python3
"""SemVer 2.0.0 precedence for the gated installer's downgrade guard (BUILD-043/044).

Usage:
  semver-compare.py valid <version>       exit 0 valid, 2 not a SemVer version
  semver-compare.py ge <candidate> <base> exit 0 candidate >= base, 1 older,
                                          2 either one missing/not SemVer

Why a full parser (#102): the old guard dropped everything after "-", so
2.0.0-rc.1 compared equal to 2.0.0 and a release candidate installed over the
stable app. Prerelease < release, rc.1 < rc.2, and build metadata ("+123") is
ignored as SemVer requires, so a build number can never make an older version
look newer.
"""
import re
import sys

SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


def parse(version):
    match = SEMVER.match(version or "")
    if not match:
        return None
    core = tuple(int(part) for part in match.group(1, 2, 3))
    pre = match.group(4)
    return core, (pre.split(".") if pre else [])


def compare_identifiers(a, b):
    a_num, b_num = a.isdigit(), b.isdigit()
    if a_num and b_num:
        return (int(a) > int(b)) - (int(a) < int(b))
    if a_num != b_num:
        # Numeric identifiers always have lower precedence than alphanumeric.
        return -1 if a_num else 1
    return (a > b) - (a < b)


def compare(a, b):
    (a_core, a_pre), (b_core, b_pre) = a, b
    if a_core != b_core:
        return (a_core > b_core) - (a_core < b_core)
    if not a_pre or not b_pre:
        # A release outranks any prerelease of the same core version.
        return (not a_pre) - (not b_pre)
    for x, y in zip(a_pre, b_pre):
        result = compare_identifiers(x, y)
        if result:
            return result
    return (len(a_pre) > len(b_pre)) - (len(a_pre) < len(b_pre))


def main(argv):
    if len(argv) == 2 and argv[0] == "valid":
        return 0 if parse(argv[1]) else 2
    if len(argv) == 3 and argv[0] == "ge":
        candidate, base = parse(argv[1]), parse(argv[2])
        if candidate is None or base is None:
            return 2
        return 0 if compare(candidate, base) >= 0 else 1
    sys.stderr.write(__doc__)
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
