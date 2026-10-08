# Terminal CPU / I/O priority

`scripts/terminal-priority.mjs` polls local terminal metadata every 12 seconds.
Research, verify, productivity and loophole titles receive Darwin background
policy; other titles receive default policy. Retitles and newly created child
processes are reconsidered. No nice-level changes or termination are used.

The port 8081 listener, Dobius+ main executable and their ancestors are protected.
Missing discovery evidence skips the cycle. Each mutation rechecks the terminal
handle, UID, PID start time, title and protected listeners. Ambiguous shared agent
servers and unresolved terminal identities are skipped. Process environment text
is inspected in memory to resolve exact terminal handles and is never logged.

Install/update with Node 24:

```sh
DOBIUS_PRIORITY_CLI=/usr/local/bin/dobius node scripts/install-terminal-priority.mjs
```

Installed 2026-10-08 under `~/Library/Application Support/dobius-priority/`.
LaunchAgent `com.verlosolutions.dobius.priority` is running with RunAtLoad and
KeepAlive. Its private log explicitly records skips for Metro and Dobius+.
Only this dedicated service is reloaded by the installer.

Verification:

- `node --test scripts/terminal-priority.node-test.mjs`: 8 tests passed, exit 0.
- `node scripts/terminal-priority.manual-proof.mjs`: exit 0. Two isolated,
  Codex-shaped fixture processes received research/build metadata. Darwin's own
  external-background query returned 1/0 respectively; changing research to
  repair restored 0. `ps` showed both alive in S state; that state alone does
  not distinguish Darwin's background policy.
- `plutil -lint` passed; `launchctl print` reports running with no prior exit.

The manual proof uses fake terminal metadata and only changes its own child
processes. The production service uses local Dobius terminal metadata.
