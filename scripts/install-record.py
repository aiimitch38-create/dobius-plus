#!/usr/bin/env python3
"""Install records that live OUTSIDE the app bundle (BUILD-044B).

Usage: install-record.py identity <bundle>
       install-record.py find <bundle> <sidecar record>

Why outside: the gated installer used to write INSTALL-PROVENANCE.json into
Contents/Resources of the bundle AFTER it was signed, which breaks the code
signature seal (codesign --verify --deep --strict fails, and macOS permission
grants tied to the signature can re-prompt). The record now sits beside the
bundle instead, and carries `bundleIdentity` so a reader can tell whether it
belongs to the bundle in front of it.

identity: sha256 of the bundle's Contents/Info.plist followed by its
  Contents/_CodeSignature/CodeResources when present (the seal, which hashes
  every sealed file, so two different signed builds never share it).
  dobius/src/main/jarvis/self-edit-repo-root.ts computes the same value.
find: prints the path of the record that belongs to <bundle>: the sidecar when
  its bundleIdentity matches, else the legacy record inside the bundle (installs
  from before BUILD-044B). Prints nothing when neither exists. Exit 0 either way.
"""
import hashlib
import json
import os
import sys

LEGACY_REL = os.path.join("Contents", "Resources", "INSTALL-PROVENANCE.json")


def bundle_identity(bundle):
    digest = hashlib.sha256()
    with open(os.path.join(bundle, "Contents", "Info.plist"), "rb") as handle:
        digest.update(b"Info.plist\0" + handle.read())
    seal = os.path.join(bundle, "Contents", "_CodeSignature", "CodeResources")
    if os.path.isfile(seal):
        with open(seal, "rb") as handle:
            digest.update(b"\0CodeResources\0" + handle.read())
    return "sha256:" + digest.hexdigest()


def sidecar_matches(bundle, sidecar):
    try:
        with open(sidecar, encoding="utf-8") as handle:
            record = json.load(handle)
        return isinstance(record, dict) and record.get("bundleIdentity") == bundle_identity(bundle)
    except (OSError, ValueError):
        return False


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "identity":
        print(bundle_identity(sys.argv[2]))
    elif len(sys.argv) == 4 and sys.argv[1] == "find":
        bundle, sidecar = sys.argv[2], sys.argv[3]
        if sidecar_matches(bundle, sidecar):
            print(sidecar)
        elif os.path.isfile(os.path.join(bundle, LEGACY_REL)):
            print(os.path.join(bundle, LEGACY_REL))
    else:
        sys.stderr.write(__doc__)
        sys.exit(64)
