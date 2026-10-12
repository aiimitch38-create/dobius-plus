# Automatic phone HTTP server

Phone address: **http://100.94.52.53:8081** over Tailscale.
Metro supplies the development phone app's JavaScript; the separate desktop
listener on 6768 handles encrypted phone commands.

Installed macOS login service: `com.verlosolutions.dobius.metro`.
It starts at login, waits for Storage and mobile dependencies, and checks every
10 seconds. If Metro is already healthy it leaves it alone. It starts a missing
server with `REACT_NATIVE_PACKAGER_HOSTNAME=100.94.52.53`, LAN listening and port
8081. Launchd restarts the supervisor if it exits. Mac must be awake/logged in,
Storage readable, and Tailscale connected on Mac and phone.

The supervisor is copied to `~/Library/Application Support/dobius-mobile` so
drive disconnection cannot remove the recovery program. It stops only server
processes it started, waits for their termination before replacement, and gives
cold startup five minutes. A stalled USB read may delay process termination;
the service avoids spawning duplicate replacements during that delay.
Large Metro output stays at `/Volumes/Storage/dev/metro.log`; internal supervisor
log contains only start/recovery metadata.

Install/update from `dobius/mobile`, with Node 24 first on PATH:
`node scripts/install-metro-supervisor.mjs`.
If updating an already loaded service, reload it:
`launchctl bootout gui/$(id -u)/com.verlosolutions.dobius.metro`
then rerun the install command. This affects Metro only, not desktop Dobius+.

Check: `curl --max-time 8 -fsS http://100.94.52.53:8081/status`.
Expected: `packager-status:running`.
Service: `launchctl print gui/$(id -u)/com.verlosolutions.dobius.metro`.
Tests: `node --test scripts/metro-supervisor.node-test.mjs`.

The service keeps HTTP available but does not re-sign/reinstall the phone,
change pairing/grants, restart Dobius+ or reconnect Tailscale itself.
After a cold start, prebuild the phone bundle with the handoff's iOS bundle URL
before reopening Dobius on the phone (the first build can take two minutes).
