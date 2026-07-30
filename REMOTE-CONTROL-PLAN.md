# Plan: Dobius+ mobile into a real remote control

Status: DRAFT for review. No code yet. Requested by Sam 2026-07-30: "redo the
dobius tailscale app thing, UI advanced heavily and polished up, essentially
like remote control."

## What exists today (mapped)

A working but bare companion PWA in `mobile/`, served by
`electron/mobile-server.js` over Tailscale (tailnet-only bind + 6-digit pairing
token, single-user by design). Three screens: Pairing, one Terminal at a time
(with a project-grouped tab switcher + a fixed special-keys bar), and a History
list (session transcripts, tap to Resume). Shared PTYs: the phone attaches to
the SAME terminals the Mac shows, over a WebSocket (`attach`/`input`/`output`/
`resize`/`kill`/`createTerminal`/`resumeSession`).

It works. It is not a remote control. The core gaps:
- **No status.** The phone lists terminals as `{id,pid,cwd}` only. It cannot
  tell which sessions are running vs idle, or which have a live Claude session
  (name/model/context). The Mac already computes all of this
  (`getTerminalClaudeInfo`, the per-tab context work from v1.0.40); it is simply
  not sent over the bridge.
- **No overview.** One xterm at a time, no at-a-glance view of everything
  running.
- **No push.** The phone is pull-only. Nothing tells you a session finished,
  needs input, or hit an error while your phone is in your pocket. That is the
  single most important "remote control" behavior and it is entirely absent.
- **No lifecycle control from the phone.** `kill` exists in the protocol but no
  UI sends it; no new-terminal-in-arbitrary-project, no rename.
- **In-app voice is missing.** The Voice Conductor is reachable only via an
  iPhone Shortcut hitting `/voice/intent`, never from the PWA itself.
- **Bare visuals.** GitHub-dark, no motion, plain "Loading...", no empty
  states, no settings/unpair screen, no service worker.

## The idea: a mission-control remote, not a tiny desktop

The desktop is where you WORK. The phone is where you WATCH and INTERVENE. So
the phone's home is not a terminal, it is a live board of every session with
status you can read in a glance, and one tap drops you into any of them to
type, send keys, stop it, or talk to it. Push notifications close the loop so
you can pocket the phone and get pulled back exactly when a session needs you.

### Design direction (committed)

A tactile "cockpit / hardware remote" aesthetic, dark and calm, built for
thumb reach and glanceability, deliberately NOT a generic dashboard:

- **Two type voices.** A characterful monospace (JetBrains Mono, bundled) for
  everything that IS the machine (session ids, project names, context %, key
  caps) and a clean geometric sans (e.g. Space Grotesk or Sora, bundled, pick
  one and commit) for human-facing chrome. No system-font default, no Inter.
- **Status as light.** Running = a soft breathing green glow; needs-input =
  amber pulse; idle = dim; error = red. The board reads like a rack of LEDs.
  Status color is the loudest thing on screen; everything else is quiet.
- **Palette.** Near-black base (not pure black), one confident accent, semantic
  status hues (green/amber/red) reserved ONLY for status so they always mean
  something. Depth from layered translucency + a faint grain, not boxes.
- **Motion with intent.** One orchestrated load (staggered card reveal), a
  physical spring when you drop into a session and back, the breathing glow.
  Nothing gratuitous. Big touch targets, safe-area aware, one-hand layout with
  the primary controls in the bottom third.
- **Tactile controls.** The special-keys bar and command bar feel like remote
  buttons (press states, subtle travel), not web buttons.

The frontend-design skill governs execution when we build; this locks the POV.

## Scope: the remote-control CORE (and what it is NOT)

IN (this effort):
1. Live **session board** with real status.
2. **Terminal control** per session: input, special keys, resize, stop/kill,
   new terminal (with a project picker), from the board.
3. **Push notifications**: session finished, needs input (prompt detected),
   process exited nonzero.
4. **In-app voice**: hold-to-talk to the Conductor, see the spoken reply.
5. **Polish**: the full aesthetic above, empty/loading/error states, a settings
   screen (unpair, LAN/tailnet, host), service worker + proper icons.

OUT (explicitly deferred, the map lists these; a remote control does not need
them and each is its own effort): in-app git/diff/commit, deploy controls,
checkpoints, agent orchestration, the Asana/task pipeline, build-monitor CI
views, scheduled tasks. If Sam wants any later they are add-on phases.

## Phases

### Phase 1: status over the bridge (backend, unblocks everything)
The board is worthless without status, and the data already exists on the Mac.
- Extend the WS `terminals` payload (and add a `terminalStatus` push) with, per
  tab: `{ id, project, cwd, label, running, claude: { sessionId, model,
  ctxPct } | null, lastActivityAt, exitInfo }`. Source it from
  `getTerminalClaudeInfo` + the v1.0.40 per-tab context estimator +
  terminal-manager activity.
- Push a `terminalStatus` message on change (attach/exit/idle transitions), so
  the board updates live without polling.
- Server work only; no PWA change yet. Verify with a WS probe.

### Phase 2: the session board (the headline UI)
- New default screen: a card per session, status-as-light, project + claude
  model + context ring, last-activity, tap to open. Orchestrated reveal.
- Reuse the existing `attach`/`output` flow when a card is opened.
- Board <-> terminal transitions with spring motion.

### Phase 3: control affordances
- From a card / open terminal: stop (send `kill`, already in protocol, add the
  UI + a confirm), new terminal with a **project picker** (needs a small
  `listProjects` WS message), rename (optional).
- Upgraded key bar: press states, add Ctrl-compose and paste.

### Phase 4: notifications + in-app voice
- **Push**: Web Push (VAPID) so the OS notifies even when the PWA is closed.
  Server holds subscriptions per device; fires on session-finished /
  needs-input / nonzero-exit. This is the reason the whole thing is a "remote
  control" and not a viewer.
- **Voice**: hold-to-talk button -> Web Speech (or record + existing
  `/voice/intent`) -> show the Conductor's reply (reuse `/voice/reply`
  long-poll or a WS `voiceReply`).

### Phase 5: PWA maturity + polish pass
- Service worker (installable, offline shell, cache the app), full icon set,
  Tailscale HTTPS note (`tailscale cert` / MagicDNS) so Web Push + install work
  cleanly, settings screen (unpair, LAN/tailnet toggle, host), error toasts.

## Files

**New (mobile/):** `Board.jsx` (the session board), `SessionCard.jsx`,
`Settings.jsx`, `VoiceButton.jsx`, `sw.js` (service worker), a `design/` token
file (CSS variables + bundled fonts), maybe `icons/` set.

**Modified (mobile/):** `App.jsx` (router: board is home; board / terminal /
history / settings), `Terminal.jsx` (open-from-board, control affordances),
`SpecialKeys.jsx` (press states, Ctrl-compose, paste), `connection.js` (new
message types), `styles.css` (replaced by the design system), `index.html`
(fonts, SW registration), `manifest.webmanifest` (icon set).

**Modified (electron/):** `mobile-server.js` (status in `terminals` +
`terminalStatus` push, `listProjects`, Web Push subscribe + send, `voiceReply`
over WS), `terminal-manager.js` (surface per-tab status/activity if not already
exposed). Reuse the v1.0.40 per-tab context estimator and
`getTerminalClaudeInfo`.

## Security / constraints (unchanged, do not regress)
- Tailnet-only bind + pairing token + single-user. Web Push needs HTTPS, which
  is the Tailscale-cert item in Phase 5; until then notifications degrade to
  in-app only.
- Shared PTYs stay the model (phone attaches to the Mac's real terminals).
- No new secret leaves the device beyond what pairing already grants.

## Verification
Each phase: Codex review (incl. one holistic pass over the whole diff before
shipping, per the v1.0.42 lesson) + build + a real device/WS test. UI phases get
a screenshot at a phone viewport. Ships as its own version, local-first, not
released without Sam's go.

## Open questions for Sam
1. **Notifications**: is setting up Tailscale HTTPS (`tailscale cert`) acceptable
   for real OS push? Without it, alerts are in-app only (must have the PWA
   open). This is the one external setup the full experience needs.
2. **Voice in-app**: hold-to-talk using the browser mic is easy but iOS Safari
   Web Speech is flaky; the robust path is record audio -> send to the Mac ->
   transcribe there. Cheap-and-flaky now, or robust-and-more-work?
3. **Aesthetic check**: the cockpit/LED direction above, or do you want a
   different flavor (e.g. ultra-minimal, or louder/maximalist)?
