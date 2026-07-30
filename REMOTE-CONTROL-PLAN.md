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

## Visual review (2026-07-30): I rendered the current screens

Not just read the code, actually built the mobile bundle, served it, and
screenshotted every screen at a 390px iPhone viewport with a mock connection.
What I saw confirms and sharpens the redesign:

- **Terminal screen**: on anything short of a full session, roughly 70% of the
  screen is dead black void below a few lines of output. The top bar
  (`● project / Tab N ▾`, history, `+`) and the full-width key bar are fine but
  utilitarian. It reads as "a raw xterm in a wrapper," not a controlled remote.
- **Switcher** (tap the title): a plain project-grouped list of tab NAMES only
  (Tab 1 / Tab 2 / + tab in project). Zero status, activity, model, or context.
  This is the only "overview" of everything running, and it is inadequate. It is
  exactly what the session board replaces.
- **History**: flat full-width rows (not cards), project name + one-line preview
  + age + a blue Resume. No search, no status, no live indicator, no grouping.
- **Pairing**: a generic centered card (`Dobius+`, instructions, a 000000
  field, a dimmed button) floating in a large empty field. No brand character.

Takeaways folded into the design: kill the dead space (the board fills the
screen with real content; a short terminal gets a compact toolbar + context,
not a void), make the overview status-rich (the switcher becomes the board),
and give Pairing + empty states actual character.

## Codex design review (2026-07-30): folded in

Codex reviewed this plan before any code and found six issues that would have
caused real rework. All are folded into the phases below; the direction is
sound, but Phase 1 and the push ordering needed rewrites.

1. **HIGH: status is NOT "already computed" in a server-usable form.** I was
   wrong that `getTerminalClaudeInfo` + the v1.0.40 context estimator can be
   bridged directly. `getTerminalClaudeInfo` returns only `{sessionId,
   startedAt}`. Model + context live behind a RENDERER IPC
   (`data:estimateContextForTab`, which rejects non-owner callers), and the
   working/idle/needs status is RENDERER Zustand state parsed from OSC/xterm
   output (`useTerminal.js`, `useTabActivity.js`), NOT terminal-manager state.
   So Phase 1 is not "bridge existing data," it is "build a MAIN-PROCESS status
   authority": parse OSC 777 in main alongside the PTY stream, track
   lastActivityAt/exitInfo/running, resolve the running session id, and add a
   non-IPC context helper that keeps the v1.0.40 stale-link safeguards. This is
   the biggest correction and the real cost of Phase 1.
2. **HIGH: "push on change" is not free for context.** Context is derived from
   the transcript FILE, not PTY events. Use a throttled aggregator: push
   immediately on PTY create/exit/output/OSC marker, recompute context on a
   15-30s debounce for Claude tabs, and send deltas only when the serialized
   status actually changes. No pgrep/transcript read per output chunk.
3. **HIGH: push phase order was wrong.** Web Push + service worker require a
   secure context, and iOS only does Web Push for an installed Home Screen app.
   So HTTPS (Tailscale cert) + service worker + manifest `id` + install flow +
   permission UI must come BEFORE push, not after. Reordered below.
4. **MEDIUM: Tailscale HTTPS needs the MagicDNS name, not the 100.x IP.** Certs
   are issued for `<machine>.<tailnet>.ts.net`, not tailnet IPs. The pairing UI
   must show/copy the `https://…ts.net:<port>/` URL, check
   `window.isSecureContext`, and label raw-IP/HTTP mode as "terminal only, no
   push or offline install."
5. **MEDIUM: rich status + listProjects widen a stolen token's value.** Auth
   already lets any paired token write/kill/create/read, so `kill` UI is not a
   new privilege, but reconnaissance value grows. Add device revocation UX +
   per-device name/lastSeen, and make `createTerminal` accept only a path that
   came from `listProjects()`, never an arbitrary cwd.
6. **HIGH: shared-PTY vs phone-spawned terminals.** Phone-created PTYs today are
   headless `term-mobile-*` with no desktop tab (tab-sync is future work), which
   contradicts "the same terminals the Mac shows." DECISION (folded in): for v1,
   phone-spawned terminals are **headless remote-only and labeled as such** on
   the board; they are not faked into desktop tabs. A future phase can add real
   desktop tab-sync through a shared registry. Do not pretend they are desktop
   tabs.
7. **MEDIUM: nonzero-exit info is lost.** `term.onExit` deletes the terminal
   entry immediately and `listTerminals()` only lists live ones, so exit
   metadata is gone before the board/push can use it. Keep a bounded recent-exit
   cache (cwd/project/session/status + code/signal) captured before deletion.

## The idea: a mission-control remote, not a tiny desktop

The desktop is where you WORK. The phone is where you WATCH and INTERVENE. So
the phone's home is not a terminal, it is a live board of every session with
status you can read in a glance, and one tap drops you into any of them to
type, send keys, stop it, or talk to it. Push notifications close the loop so
you can pocket the phone and get pulled back exactly when a session needs you.

### Design direction (committed)

Cockpit/LED status semantics rendered in the CLAUDE MOBILE APP's visual
language (Sam: "most modern, most like the Claude mobile app UI"). Calm, warm,
composed, thumb-first and glanceable, NOT a neon arcade or a GitHub-blue dev
tool (which is what it is today):

- **Palette: Claude, not GitHub.** Warm near-black in dark mode / off-white
  cream in light mode, with the clay/terracotta accent (~#C15F3C) instead of
  the current #58A6FF blue. Semantic status hues (green/amber/red) reserved
  ONLY for status so a color always means something. Depth from soft shadows
  and warm translucency, generous negative space, not hard boxes.
- **Status as calm light.** Running = a soft breathing green ring; needs-input =
  amber; idle = dim; error = red. The board reads like a quiet rack of
  indicators, composed rather than loud. Status is the most saturated thing on
  an otherwise warm, low-contrast screen.
- **Type: the Claude register.** A refined humanist serif for display accents
  (Tiempos-like) paired with a clean grotesque for UI (Styrene-like), plus a
  mono only for the actual terminal + machine tokens (session id, context %,
  key caps). Bundle open near-equivalents (the real Claude faces are
  proprietary). No system-font default, no Inter, no GitHub mono chrome.
- **Motion with intent.** One orchestrated load (staggered card reveal), a soft
  spring when you drop into a session and back, the breathing status ring.
  Restrained, in the Claude calm register. Big touch targets, safe-area aware,
  primary controls in the bottom third for one-hand use.
- **Tactile controls.** Special-keys and command bar have real press states and
  subtle travel, but soft and rounded, not hardware-brutal.

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

### Phase 1: main-process status authority (backend, unblocks everything)
Not a bridge, a build (Codex #1/#2/#7). The board is worthless without status,
and status currently lives in the renderer.
- New `electron/terminal-status.js`: a main-process authority that, per live
  terminal, tracks `running`, `lastActivityAt`, and `status`
  (working/idle/needs-input) by parsing OSC 777 / prompt markers in the PTY
  data stream (the same signal the renderer parses today), plus resolves the
  running Claude session id.
- Context/model: a NON-IPC helper equivalent to `estimateContextForTab` that
  keeps the v1.0.40 stale-link safeguards, recomputed on a 15-30s debounce for
  Claude tabs (context is transcript-derived, not PTY-evented).
- Bounded recent-exit cache: capture `{cwd, project, session, status, code,
  signal}` in `term.onExit` BEFORE the entry is deleted, so exit info survives
  for the board and push.
- Bridge: extend the WS `terminals` payload and add a throttled
  `terminalStatus` push (immediate on create/exit/OSC marker, debounced for
  context), sending deltas only when serialized status changes.
- Server + main only; no PWA change yet. Verify with a WS probe.

### Phase 2: the session board (the headline UI)
- New default screen: a card per session, status-as-light, project + claude
  model + context ring, last-activity, tap to open. Orchestrated reveal.
- Reuse the existing `attach`/`output` flow when a card is opened.
- Board <-> terminal transitions with spring motion.

### Phase 3: control affordances
- From a card / open terminal: stop (send `kill`, already in protocol, add the
  UI + a confirm), new terminal with a **project picker** (`listProjects` WS
  message; `createTerminal` accepts ONLY a path returned by it, never an
  arbitrary cwd, Codex #5). Phone-spawned terminals are labeled
  **remote-only** on the board, not faked as desktop tabs (Codex #6).
- Upgraded key bar: press states, add Ctrl-compose and paste.

### Phase 4: HTTPS + PWA maturity (MUST precede push, Codex #3/#4)
- `https.createServer` using Tailscale cert material; pairing UI shows/copies
  the `https://<machine>.<tailnet>.ts.net:<port>/` MagicDNS URL and checks
  `window.isSecureContext`. Raw-IP/HTTP mode is labeled "terminal only, no push
  or offline install."
- Service worker (installable, offline shell), manifest `id` + full icon set,
  install-to-Home-Screen flow (iOS requires it for push), settings screen
  (unpair + per-device lastSeen/revoke, LAN/tailnet toggle, host), error toasts.

### Phase 5: notifications + in-app voice (needs Phase 4's secure context)
- **Push**: Web Push (VAPID); server holds per-device subscriptions, fires on
  session-finished / needs-input / nonzero-exit (from the Phase 1 status
  authority + recent-exit cache). Feature-detect `PushManager` /
  `isSecureContext` and degrade to in-app alerts otherwise. This is the reason
  the whole thing is a remote control and not a viewer.
- **Voice (decided: server-side whisper.cpp)**: hold-to-talk records audio on
  the phone, streams it over the Tailscale WS to the Mac, which transcribes
  locally with `whisper-cli` (whisper.cpp/Metal, the `audio-transcribe` engine),
  then feeds the transcript into the existing `/voice/intent` -> Conductor flow
  and returns the reply via `/voice/reply`. Audio never leaves the tailnet; no
  cloud STT. Build phase resolves the `whisper-cli` path + model like
  gws-accounts resolves the gws binary.

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

## Decisions (resolved 2026-07-30 with Sam)

1. **HTTPS + push: yes.** Use `tailscale cert` for a browser-trusted cert on
   the MagicDNS name so Web Push and install work. This is the transport for
   Phase 4/5.
2. **Voice: server-side whisper.cpp (open source, already on this Mac).** Sam
   asked to reuse an existing OSS piece rather than build STT. The phone records
   audio and streams it over the Tailscale WS; the Mac transcribes locally with
   `whisper-cli` (whisper.cpp, Metal), the same engine the `audio-transcribe`
   skill uses (model at `~/.samknows/models/ggml-base.en.bin`; the build phase
   resolves the exact `whisper-cli` path like gws-accounts resolves gws). The
   transcript feeds the existing `/voice/intent` -> Conductor flow, and the
   spoken/text reply comes back via `/voice/reply`. Fully private: audio never
   leaves the tailnet, no cloud STT. This replaces the "cheap Web Speech"
   option; it is robust AND reuses OSS already installed.
3. **Aesthetic: cockpit/LED semantics rendered in the Claude mobile app's
   visual language.** Sam: "most modern, most like the Claude mobile app UI."
   So: a warm, calm palette (Claude's near-black warm dark + off-white/cream
   light, the clay/terracotta accent ~#C15F3C rather than the GitHub blue used
   today), generous spacing, soft large radii, quiet chrome, a refined
   humanist-serif display accent paired with a clean grotesque for UI, all in
   the Claude register. The "LED" status idea survives as calm colored status
   glyphs/rings, not a loud arcade look: modern and composed, not neon. Bundle
   close-to-Claude open fonts (e.g. a Tiempos-like serif + a Styrene-like
   grotesque) since the real Claude fonts are proprietary.
