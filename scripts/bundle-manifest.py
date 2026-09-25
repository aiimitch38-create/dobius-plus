#!/usr/bin/env python3
"""Artifact manifest for a packaged macOS Dobius+.app (BUILD-045, #101).

Usage: bundle-manifest.py <path to Dobius+.app>
  exit 0  every required artifact is present
  exit 1  one or more are missing; each is printed on its own line (stdout)
  exit 2  usage error

Why: the old build-and-install.sh ran only part of the build graph (no
build:cli / relay / web / native) and still produced an installable-looking
bundle. ADAM's Dobius adapter (service/src/adapters/dobius.ts, snapshotBundle)
then refused it because Contents/Resources/app.asar.unpacked/out/cli/index.js
was missing. The gated installer runs this on the staged copy BEFORE it quits
the app, so a partial build is refused and the installed app stays untouched.

Each entry names the build step that produces it (dobius/package.json).
"""
import json
import os
import struct
import sys

RESOURCES = "Contents/Resources"

# Files that must be inside app.asar (non-empty entries).
ASAR_ENTRIES = [
    ("out/main/index.js", "build:electron-vite"),
    ("out/preload/index.js", "build:electron-vite"),
    ("out/renderer/index.html", "build:electron-vite"),
    ("out/web/web-index.html", "build:web"),
    ("out/cli/index.js", "build:cli"),
]

RELAY_PLATFORMS = [
    "linux-x64",
    "linux-arm64",
    "darwin-x64",
    "darwin-arm64",
    "win32-x64",
    "win32-arm64",
]

# Non-empty regular files on disk, relative to the bundle root.
DISK_FILES = [
    # ADAM's adapter launches this exact path outside the asar.
    (RESOURCES + "/app.asar.unpacked/out/cli/index.js", "build:cli"),
    (RESOURCES + "/app.asar.unpacked/out/package.json", "build:cli"),
    (RESOURCES + "/app.asar.unpacked/out/main/daemon-entry.js", "build:electron-vite"),
    # ADAM's adapter also requires the Electron framework and its signature.
    (
        "Contents/Frameworks/Electron Framework.framework/Electron Framework",
        "electron-builder",
    ),
    (
        "Contents/Frameworks/Electron Framework.framework/Versions/Current/_CodeSignature/CodeResources",
        "electron-builder",
    ),
]
for _platform in RELAY_PLATFORMS:
    DISK_FILES.append((RESOURCES + "/relay/" + _platform + "/relay.js", "build:relay"))
    DISK_FILES.append((RESOURCES + "/relay/" + _platform + "/.version", "build:relay"))

# Non-empty executable files on disk.
DISK_EXECUTABLES = [
    (RESOURCES + "/bin/dobius", "electron-builder extraResources"),
    (
        RESOURCES + "/Dobius+ Computer Use.app/Contents/MacOS/dobius-computer-use-macos",
        "build:native",
    ),
]


def read_asar_header(asar_path):
    """Return (header dict, data offset, file size) or raise ValueError."""
    size = os.path.getsize(asar_path)
    with open(asar_path, "rb") as handle:
        prefix = handle.read(8)
        if len(prefix) != 8:
            raise ValueError("too short to be an asar archive")
        size_payload, header_size = struct.unpack("<II", prefix)
        if size_payload != 4 or header_size < 8 or 8 + header_size > size:
            raise ValueError("not an asar archive (bad size header)")
        header = handle.read(header_size)
    string_length = struct.unpack("<I", header[4:8])[0]
    if 8 + string_length > header_size:
        raise ValueError("not an asar archive (bad header string length)")
    return json.loads(header[8 : 8 + string_length].decode("utf-8")), 8 + header_size, size


def asar_entry(header, relative_path):
    node = header
    for part in relative_path.split("/"):
        children = node.get("files") if isinstance(node, dict) else None
        if not isinstance(children, dict) or part not in children:
            return None
        node = children[part]
    return node


def asar_entry_ok(entry, data_offset, archive_size):
    if not isinstance(entry, dict) or "files" in entry:
        return False
    entry_size = entry.get("size")
    if not isinstance(entry_size, int) or entry_size <= 0:
        return False
    # Unpacked entries live on disk; their data is not in the archive.
    if entry.get("unpacked") is True:
        return True
    try:
        offset = int(entry.get("offset"))
    except (TypeError, ValueError):
        return False
    return data_offset + offset + entry_size <= archive_size


def disk_file_ok(path, executable):
    # os.path.isfile follows symlinks, as the framework's top-level entry is one.
    if not os.path.isfile(path) or os.path.getsize(path) <= 0:
        return False
    return os.access(path, os.X_OK) if executable else True


def missing_artifacts(bundle):
    missing = []
    asar_path = os.path.join(bundle, RESOURCES, "app.asar")
    try:
        header, data_offset, archive_size = read_asar_header(asar_path)
    except (OSError, ValueError, UnicodeDecodeError) as error:
        missing.append("%s/app.asar is not a readable asar archive (%s)" % (RESOURCES, error))
        header = None
    if header is not None:
        for relative_path, step in ASAR_ENTRIES:
            if not asar_entry_ok(asar_entry(header, relative_path), data_offset, archive_size):
                missing.append("%s/app.asar:%s (from %s)" % (RESOURCES, relative_path, step))
    for relative_path, step in DISK_FILES:
        if not disk_file_ok(os.path.join(bundle, relative_path), False):
            missing.append("%s (from %s)" % (relative_path, step))
    for relative_path, step in DISK_EXECUTABLES:
        if not disk_file_ok(os.path.join(bundle, relative_path), True):
            missing.append("%s (from %s, must be executable)" % (relative_path, step))
    return missing


def main(argv):
    if len(argv) != 2:
        sys.stderr.write("usage: bundle-manifest.py <path to Dobius+.app>\n")
        return 2
    missing = missing_artifacts(argv[1])
    for item in missing:
        print(item)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
