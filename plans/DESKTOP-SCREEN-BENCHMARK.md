# Desktop capture benchmark — native selected

2026-10-07, this Mac. Required run: main display, 1280 px wide, 3 fps,
JPEG quality approximately 60, 60 seconds. No frames were logged or persisted.

| Backend | Actual result | Performance metrics |
| --- | --- | --- |
| A: Electron 42.3.3 thumbnail polling | Earlier repaired-app preflight returned `getMediaAccessStatus('screen') = denied`, exit 2. Final 60-second bounded preflight logged bootstrap but did not reach `app.whenReady()` before exit 142. | Unavailable; no valid first frame or 60-second run. |
| B: native display-only ScreenCaptureKit prototype | Independent launchd launch passed its own permission gate and completed the configured 60-second capture. | 136 callbacks / 65.385 s total = 2.080 fps; first frame 10007.7 ms; main-loop maximum lag 7056.7 ms; CPU 3.628%; peak RSS 104.719 MiB; 387024.6 bytes/s. |

Backend choice is **B: native ScreenCaptureKit**, under Carson/Claude's explicit
fallback decision on 2026-10-07: one final Electron attempt with a 60-second bound,
then choose native if it is denied or times out. That final attempt, with Dobius+
Screen Recording confirmed enabled, exited 142 without output or measurements.
No further identity experiments will run. Electron performance remains unmeasured;
this selection is a documented fallback, not a claim native meets the targets.
Native fails the <3-second first-frame and <50 ms main-loop-lag targets in this run.

Phase 1 optimization work: one persistent SCStream per approved viewing session,
JPEG encoding on a serial background queue, complete-frame filtering, bounded
newest-frame delivery, and no per-frame helper process launches or blocking waits
on the desktop main thread. Re-measure first-frame time and lag before claiming
acceptance. Only capture during consented, leased viewing; do not keep an idle
screen-capturing stream alive as a startup optimization.

Native measurement: 1280 × 832, JPEG quality 0.6, requested 3 fps. The measurement
window includes stream startup/shutdown, so it is 65.385 seconds rather than exactly
60. Its compiled prototype counts image-buffer callbacks; it does not filter idle
frame status. Accordingly 2.080 fps is an upper bound on complete-frame throughput,
not phone-rendered fps. The source was subsequently improved to filter complete
frames but was deliberately not recompiled over the executable Carson had just
authorized. This run measures that original executable. The main-loop lag is the
native main dispatch queue's timer lag, not an Electron event-loop measurement.
The aggregate JSON is in `~/Library/Logs/dobius-native-screen-benchmark.json`.
Temporary launchd benchmark jobs were removed after collecting the result.

Electron source: `dobius/tools/benchmarks/desktop-screen-capture.cjs`.
Native source/executable: `/Volumes/Storage/dev/codex-runs/screen-capture-prototype.swift`
and `/Volumes/Storage/dev/codex-runs/screen-capture-prototype`.
Native prototype uses main-display SCContentFilter and JPEG encoding in memory;
it does not use `getAppState`, Accessibility, window capture or disk images.
Swift compile produced concurrency warnings about NSLock in async context under
Swift 5; this measurement prototype is not shipping helper implementation.

User prerequisite for native measurement: enable Screen & System Audio Recording
for the prototype executable in macOS privacy settings. Capture remains gated on
its own permission check. This does not authorize the packaged Dobius+ identity.
Electron startup diagnosis: cached archive lacked `_CodeSignature/CodeResources`
while its executable signature required sealed resources. Both `codesign --verify`
and `spctl --assess` failed with “code has no resources but signature indicates
they must be present.” Normal LaunchServices launch failed with `-10810`; raw
launch under a 60-second Perl alarm exited 142 without benchmark output.
`codesign --force --deep --sign -` on the isolated benchmark copy exited 0.
The subsequent 60-second bounded preflight logged Electron 42.3.3 bootstrap,
reported `permission=denied`, and exited 2. This resolves startup sufficiently
to check the correct Electron capture identity. Subsequent deep/strict signature
verification exited 0: “valid on disk” and “satisfies its Designated Requirement.”
No installed Dobius+ bundle was modified, restarted or installed.

Carson enabled both prototype identities. macOS TCC logs confirm the native grant.
Terminal-spawned processes nevertheless inherit the old Dobius+ host as their
responsible permission identity; its stored requirement failed. The independent
native launch solved that attribution. Independent Electron startup still did not
reach the script, and the experiment was stopped. A final raw preflight has a
60-second Perl alarm and exited 142 after bootstrap without a permission result.
Child rendezvous errors appeared after the parent alarm terminated it; those are
not evidence that capture itself failed. Do not spend further time experimenting with launch identities:
Carson confirmed Dobius+ Screen Recording is already enabled without a restart.
The explicitly requested final 60-second benchmark attempt still exited 142
without output. That clears the decision gate by the user's fallback instruction.
No installed desktop app was changed or restarted by the agent. Do not silently
request permission. Shipping native capture must preflight its own helper identity;
neither this prototype grant nor Dobius+'s checkbox proves the packaged helper grant.

Separate physical phone acceptance remains unverified and requires the later
approved desktop installation, new pairing, screen grant and local setup.

Operational recovery now verified: `curl --max-time 8 -fsS
http://100.94.52.53:8081/status` returned `packager-status:running`. Five supervisor
tests and focused oxlint passed. Real unplug/remount recovery has not been
intentionally tested. USB phone detection returned `[]`; desktop listens on 6768.
