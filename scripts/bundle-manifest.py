#!/usr/bin/env python3
"""Validate a packaged macOS Dobius+.app before the installer quits the current app."""
import importlib.util
import os
import sys

RESOURCES = "Contents/Resources"
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
DISK_FILES = [
    (RESOURCES + "/app.asar.unpacked/out/cli/index.js", "build:cli"),
    (RESOURCES + "/app.asar.unpacked/out/package.json", "build:cli"),
    (RESOURCES + "/app.asar.unpacked/out/main/daemon-entry.js", "build:electron-vite"),
    (
        "Contents/Frameworks/Electron Framework.framework/Electron Framework",
        "electron-builder",
    ),
    (
        "Contents/Frameworks/Electron Framework.framework/Versions/Current/_CodeSignature/CodeResources",
        "electron-builder",
    ),
]
CATALOG_HELPER_FILES = [
    (
        RESOURCES + "/data-catalog/descriptor-directory-bridge.py",
        "electron-builder extraResources (data catalog)",
    ),
    (
        RESOURCES + "/data-catalog/native-root-identity.py",
        "electron-builder extraResources (data catalog)",
    ),
]
ADAM_GATEWAY_FILES = [
    (RESOURCES + "/adam-telegram/" + filename, "electron-builder extraResources (Adam gateway)")
    for filename in (
        "bridge_runner.py", "bridge_protocol.py", "bridge_receipts.py", "bridge_dispatch.py",
        "gateway_host.py", "platform_adapter.py", "policy_manifest.py",
        "hermes-core-policy-manifest.json", "hermes-core-policy.patch",
    )
]
for _platform in RELAY_PLATFORMS:
    DISK_FILES.extend(
        [
            (RESOURCES + "/relay/" + _platform + "/relay.js", "build:relay"),
            (RESOURCES + "/relay/" + _platform + "/.version", "build:relay"),
        ]
    )
DISK_EXECUTABLES = [
    (RESOURCES + "/bin/dobius", "electron-builder extraResources"),
    (
        RESOURCES + "/Dobius+ Computer Use.app/Contents/MacOS/dobius-computer-use-macos",
        "build:native",
    ),
]

_CONTRACT_PATH = os.path.join(os.path.dirname(__file__), "bundle-resource-contract.py")
_CONTRACT_SPEC = importlib.util.spec_from_file_location("bundle_resource_contract", _CONTRACT_PATH)
if _CONTRACT_SPEC is None or _CONTRACT_SPEC.loader is None:
    raise ImportError("cannot load bundle resource contract")
resource_contract = importlib.util.module_from_spec(_CONTRACT_SPEC)
_CONTRACT_SPEC.loader.exec_module(resource_contract)

read_asar_header = resource_contract.read_asar_header
asar_entry = resource_contract.asar_entry
asar_entry_ok = resource_contract.asar_entry_ok


def disk_file_ok(path, executable):
    # Framework entries intentionally follow electron-builder's legitimate symlinks.
    if not os.path.isfile(path) or os.path.getsize(path) <= 0:
        return False
    return not executable or os.access(path, os.X_OK)


def _catalog_helper_status(bundle, relative_path):
    return resource_contract.regular_resource_status(bundle, relative_path)


def _missing_adam_gateway_resources(bundle, header, data_offset, archive_size, descriptor, identity):
    enabled, error = resource_contract.adam_gateway_capability(
        bundle, header, data_offset, archive_size, descriptor, identity
    )
    if error is not None:
        return ["%s/app.asar out/main Adam gateway capability could not be inspected (%s)"
                % (RESOURCES, error)]
    # The directory itself counts: even an empty or unsafe partial resource
    # tree must not masquerade as a legacy build lacking this feature.
    resource_present, _valid = resource_contract.regular_resource_status(
        bundle, RESOURCES + "/adam-telegram"
    )
    if not enabled and not resource_present:
        return []
    return [
        "%s (from %s, must be a non-empty readable regular file under Resources; "
        "symlinks and unsafe parent directories are refused)" % (relative_path, step)
        for relative_path, step in ADAM_GATEWAY_FILES
        if not resource_contract.regular_resource_status(bundle, relative_path)[1]
    ]


def missing_artifacts(bundle):
    missing = []
    asar_descriptor = None
    try:
        header, data_offset, archive_size, asar_descriptor, asar_identity = read_asar_header(bundle)
    except (OSError, ValueError, UnicodeDecodeError, RecursionError) as error:
        missing.append("%s/app.asar is not a readable asar archive (%s)" % (RESOURCES, error))
        header = None
    if header is not None:
        try:
            for relative_path, step in ASAR_ENTRIES:
                if not asar_entry_ok(asar_entry(header, relative_path), data_offset, archive_size):
                    missing.append("%s/app.asar:%s (from %s)" % (RESOURCES, relative_path, step))

            missing.extend(_missing_adam_gateway_resources(
                bundle, header, data_offset, archive_size, asar_descriptor, asar_identity
            ))

            # A missing required entry already rejects the bundle; avoid duplicate diagnostics.
            if asar_entry(header, "out/main/index.js") is None:
                catalog_enabled, inspection_error = False, None
            else:
                catalog_enabled, inspection_error = resource_contract.catalog_capability(
                    bundle, header, data_offset, archive_size, asar_descriptor, asar_identity
                )
            if inspection_error is not None:
                missing.append(
                    "%s/app.asar out/main catalog capability could not be inspected (%s)"
                    % (RESOURCES, inspection_error)
                )
            else:
                helper_status = [
                    _catalog_helper_status(bundle, relative_path)
                    for relative_path, _step in CATALOG_HELPER_FILES
                ]
                if catalog_enabled or any(present for present, _valid in helper_status):
                    for (relative_path, step), (_present, valid) in zip(
                        CATALOG_HELPER_FILES, helper_status
                    ):
                        if not valid:
                            missing.append(
                                "%s (from %s, must be a non-empty readable regular file under Resources; "
                                "symlinks and unsafe parent directories are refused)"
                                % (relative_path, step)
                            )
        finally:
            os.close(asar_descriptor)

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
