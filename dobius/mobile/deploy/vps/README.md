# Phone launcher on the VPS

This serves the JavaScript bundle to the existing Dobius development client.
It does not build, install, or change the native phone app. The accepted phone
installation remains version 0.0.22 / build 2. Checked-in `ios.buildNumber` is
not evidence of the installed phone's build number.

## Source and placement

- Canonical laptop repository: `~/Projects (Code)/Dobius/dobius-plus`.
- VPS repository: `/srv/dobius/workspaces/dobius-plus`.
- Phone source: `dobius/mobile/`, including `packages/expo-two-way-audio/`.
- Shared source: `dobius/src/shared/`; Metro imports it from outside mobile.
- VPS recovery bundle: `/srv/dobius/recovery/`.
- Local recovery bundle: `~/Documents/Dobius Recovery/`.

Transfer a verified Git bundle, not an external-disk checkout or Mac
`node_modules`. The initial recovery checkpoint is
`e45dcf493a2e2d3e59874e7e9b3c8c0391248097` on `fix/channel-cost`.
It includes that branch's committed history. Uncommitted changes from the
failed external disk are not reconstructed by this deployment.

## Install on Linux

Use the existing `dobius` user, Node 22.23.2 or a compatible newer release,
pnpm 10.34.5, and the phone's frozen lockfile. The VPS is Linux x86_64; native
dependencies must be installed there. Never reuse Mac binaries.

After transferring the bundle to a new recovery path:

```sh
runuser -u dobius -- git clone --branch fix/channel-cost \
  /srv/dobius/recovery/dobius-plus-phone-vps-e45dcf49.bundle \
  /srv/dobius/workspaces/dobius-plus
runuser -u dobius -- git -C /srv/dobius/workspaces/dobius-plus bundle verify \
  /srv/dobius/recovery/dobius-plus-phone-vps-e45dcf49.bundle
runuser -u dobius -- sh -c \
  'cd /srv/dobius/workspaces/dobius-plus/dobius/mobile && pnpm install --frozen-lockfile'
runuser -u dobius -- sh -c \
  'cd /srv/dobius/workspaces/dobius-plus/dobius/mobile && node scripts/build-terminal-webview-engine.mjs'
install -d -m 755 /etc/dobius
install -m 644 dobius/mobile/deploy/vps/dobius-metro.service /etc/systemd/system/
install -m 644 dobius/mobile/deploy/vps/metro.env.example /etc/dobius/metro.env
systemd-analyze verify /etc/systemd/system/dobius-metro.service
systemctl daemon-reload
systemctl enable --now dobius-metro.service
tailscale serve --bg --tcp=8081 tcp://127.0.0.1:8082
```

Run administration commands as root. The `install` commands use files from
this repository. Set the environment file to the actual VPS Tailscale IP.
Inspect `tailscale serve status --json` before adding a forwarder; preserve
existing services. Never use `tailscale funnel` or expose Metro on the public
interface. Tailscale keeps the background forwarder across restarts.

The service runs unprivileged, restarts on failure and at boot, limits memory
to 2500 MiB and CPU to 1.5 cores, and uses two Metro workers. This leaves room
for the existing Dobius app server and other VPS services. `CI=1` disables
file watching; deploy a reviewed checkpoint and restart after source changes.
The private Metro cache survives service restarts under
`/var/cache/dobius-metro`. Two workers keep transformations out of the request
handler; one worker caused health checks to stall during the first cold build.

## Verify before using the phone

From the laptop repository, run the complete integration check:

```sh
python3 dobius/mobile/deploy/vps/verify-launcher.py http://100.98.24.1:8081 \
  --version 0.0.22 --output "$HOME/Documents/Dobius Recovery/launcher-verification"
```

It checks readiness, the custom-client redirect, advertised host/version,
every iOS route with lazy bundling disabled, JavaScript syntax, and a real
PNG asset. It saves the manifest, bundle, asset, hashes, and verification JSON.
It requires Python 3.9+ and Node on the machine performing the verification.
The first cold compilation can take several minutes.

For individual checks:

```sh
systemctl is-enabled dobius-metro.service
systemctl is-active dobius-metro.service
curl --fail http://100.98.24.1:8081/status
curl --fail --head \
  'http://100.98.24.1:8081/_expo/link?platform=ios&choice=expo-dev-client'
curl --fail -H 'expo-platform: ios' -H 'accept: application/expo+json' \
  http://100.98.24.1:8081/ > /tmp/dobius-ios-manifest.json
```

Inspect the manifest's `launchAsset.url` and fetch that URL with `curl --fail`.
The iOS bundle must actually compile and return JavaScript, rather than a JSON
error. Its URL and asset URLs must point to the Tailscale address. Check `ss
-ltnp`: Metro's backend must be loopback-only. Test a service restart and repeat
the health and manifest checks. Inspect `journalctl -u dobius-metro.service`.

On the phone, enable Tailscale, open the existing Dobius development launcher,
and enter `http://100.98.24.1:8081`. In this SDK 55 CLI, `/_expo/link` redirects
to the development-client deep link when `choice=expo-dev-client` is supplied;
the newer `/_expo/open` route is absent.
Native capabilities remain those embedded in
the installed app; loading a bundle does not add native modules.

The launcher (8081) and the Dobius app server (6768) are separate. Existing
saved laptop hosts still refer to the laptop; pairing with the VPS is separate
from selecting the development server.

## Maintenance and rollback

```sh
systemctl restart dobius-metro.service
journalctl -u dobius-metro.service -n 100 --no-pager
```

Keep a verified Git checkpoint before updating. Restore that checkpoint,
install its frozen dependencies, regenerate the terminal engine, restart,
and fetch the real iOS bundle again. Stop only this service and remove only
its Tailscale port to roll back hosting:

```sh
systemctl disable --now dobius-metro.service
tailscale serve --tcp=8081 off
```

The old Mac Metro LaunchAgent can be disabled only after successful VPS
verification. Preserve its plist and supervisor for rollback. It points to
the failed external disk, so reenabling it requires correcting those paths.
This migration does not resume paused development workers.

S3 backup setup is independent. This workspace is under the planned VPS
backup root, but no AWS backup is complete until credentials, a successful
snapshot, and a restore verification have been confirmed.
