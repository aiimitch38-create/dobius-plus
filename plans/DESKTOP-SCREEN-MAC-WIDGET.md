# Step 8: Mac viewing indicator

The existing consent indicator is now a single 240 × 44 sandboxed window in the
top-right work area, with a 16 px margin, rounded corners, draggable label,
red dot, escaped phone name and Stop button. It is shown before ready/capture.
Failed loading or showing rejects the session; hide/close/renderer loss ends it.
The window has no preload, general RPC bridge or frame channel.

## Authorized fallback

**Thumbnail dropped: mirror-in-mirror unsolved.** On 2026-10-08, the built native
helper's `--screen-status` exited 0 and reported `granted:false` under the current
launch identity. No screen permission was requested or changed. Therefore no
real captured frame could prove exclusion. The native filter currently excludes
no windows; content protection is not assumed to hide a window from ScreenCaptureKit.
No live thumbnail is shipped, as explicitly allowed by section 7 of the addendum.
The status indicator itself can appear on the phone; it contains no recursive image.

Future thumbnail acceptance requires a real capture with the widget's CGWindowID
excluded through SCContentFilter, or proven content protection. Inspect pixels in
memory only. Do not enable a thumbnail based only on a mocked exclusion test.

## Verification coverage

- (a) Open/close and stop/revoke/sleep/shutdown teardown: service/window tests.
- (b) Widget Stop invalidates the active session; old renewal fails and late frames
  cannot send. The phone requires an explicit start and new Mac consent.
- (c) Multiple delivered frames still have exactly one capture start.
- (d) Load and visibility failures prevent capture.
- (e) Native exclusion / live pixel proof: UNVERIFIED, not applicable to this
  no-thumbnail fallback. No exclusion implementation is claimed.

Physical full-screen/Spaces visibility and real Mac/iPhone lifecycle behavior
remain acceptance checks after Carson approves and performs installation.
