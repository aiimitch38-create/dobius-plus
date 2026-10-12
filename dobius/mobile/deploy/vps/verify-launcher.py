#!/usr/bin/env python3
"""Verify the private launcher, complete iOS bundle, and a real app asset."""

import argparse
import hashlib
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def fetch(url, headers=None, timeout=30):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), dict(response.headers)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Private Tailscale launcher URL")
    parser.add_argument("--version", required=True, help="Expected phone app version")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    base = args.url.rstrip("/")
    origin = urllib.parse.urlsplit(base)
    if origin.scheme not in ("http", "https") or origin.path or origin.query:
        parser.error("Use an HTTP(S) origin without a path or query")
    args.output.mkdir(parents=True, exist_ok=True)

    deadline = time.monotonic() + 60
    while True:
        try:
            status, _ = fetch(base + "/status", timeout=5)
            if status != b"packager-status:running":
                raise RuntimeError(f"Unexpected Metro status: {status!r}")
            break
        except (OSError, RuntimeError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(2)

    # SDK 55 redirects to the installed native dev client instead of returning JSON.
    request = urllib.request.Request(
        base + "/_expo/link?platform=ios&choice=expo-dev-client"
    )
    try:
        urllib.request.build_opener(NoRedirect()).open(request, timeout=15)
    except urllib.error.HTTPError as response:
        if response.code != 307:
            raise
        deep_link = response.headers["Location"]
        response.close()
    else:
        raise RuntimeError("The launcher did not return a development-client redirect")
    link = urllib.parse.urlsplit(deep_link)
    if link.netloc != "expo-development-client" or urllib.parse.parse_qs(link.query).get("url") != [base]:
        raise RuntimeError(f"Incorrect development-client URL: {deep_link}")

    raw, _ = fetch(base + "/", {"expo-platform": "ios", "accept": "application/expo+json"})
    manifest = json.loads(raw)
    client = manifest["extra"]["expoClient"]
    if client["version"] != args.version or client["hostUri"] != origin.netloc:
        raise RuntimeError("The manifest advertises the wrong version or host")
    (args.output / "ios-manifest.json").write_bytes(raw)

    bundle_url = manifest["launchAsset"]["url"]
    parsed = urllib.parse.urlsplit(bundle_url)
    if (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc):
        raise RuntimeError("The bundle points outside the private launcher")
    query = urllib.parse.parse_qs(parsed.query)
    # Lazy entry bundles do not prove every app route can compile.
    query["lazy"] = ["false"]
    bundle_url = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query, doseq=True)))
    started = time.monotonic()
    bundle, headers = fetch(bundle_url, timeout=300)
    if "javascript" not in headers.get("Content-Type", "").lower() or len(bundle) < 100_000:
        raise RuntimeError("Metro did not return a complete JavaScript bundle")
    bundle_path = args.output / "ios-full-bundle.js"
    bundle_path.write_bytes(bundle)
    subprocess.run(["node", "--check", str(bundle_path)], check=True)

    asset_url = base + "/assets/" + urllib.parse.quote(client["icon"].removeprefix("./")) + "?platform=ios"
    icon, _ = fetch(asset_url)
    if not icon.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("The app icon endpoint did not return a PNG")
    (args.output / "icon.png").write_bytes(icon)
    evidence = {
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "url": base,
        "version": args.version,
        "deepLink": deep_link,
        "bundleBytes": len(bundle),
        "bundleSha256": hashlib.sha256(bundle).hexdigest(),
        "bundleSeconds": round(time.monotonic() - started, 2),
        "iconSha256": hashlib.sha256(icon).hexdigest(),
        "javascriptSyntax": "passed",
    }
    (args.output / "verification.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
