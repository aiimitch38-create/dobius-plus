# Dobius+ standing backlog

Maintained by the machine (/start-dobius-plus-machine). Checked items name
the version or branch that shipped them. Sam triggers releases.

## Queue

- [ ] Multi PRIMARY window per project (Brett, Asana 1217283122193749):
      openProjectWindow focuses the existing window and lastOpenProjects
      dedupes by path, so a project can only ever have one main window plus
      tear-offs. Needs a real "New Window" feature if Brett wants two
      independent primaries. Sized only after he confirms how he made his.
- [ ] Exclude headless `claude -p` transcripts (SamKnows.app, every ~40s)
      from continued-session resolution: accepted residual documented at
      resolveContinuedSessionId. Needs transcript-content inspection to spot
      a one-shot run; the link is tagged 'fresh' so auto-resume ignores it.

- [ ] Selector-parser accepted residuals (revisit only if Sam reports ghost
      popups): answered AskUserQuestion + <=3 indented response lines briefly
      reads live; a rule row after the footer reads live (boxed-prompt border
      is the same shape, locked by test 27).
- [ ] Watch item: one ship-test run left an orphaned "sending..." echo bubble
      in the mobile chat DOM while React state showed echoes=[] (TTL prune
      had run correctly). Not reproduced in a clean flow; fresh clients render
      clean. If a stuck "sending..." ever survives past 90s in real use,
      suspect a commit-phase exception around session relink and start here.

## Staged on fix/mobile-chat-bugs (unreleased, next ship = v1.0.62)

- [x] Push-based selector popups (Sam 8/16: "did you get rid of the poll
      latency?"): the server watches every PTY's output and, 350ms after the
      drawing goes quiet (a waiting dialog IS quiet output), renders the
      screen once and pushes the popup to sockets with fresh probe interest.
      Q2-of-N and spontaneous dialogs now pop in well under a second instead
      of up to 2.5s; the client poll stays as reconnect fallback. Dedupe
      invalidated on mobile input (identical redrawn dialog still pushes),
      interest hard-capped at 64 tabs. Live-verified: a real TUI dialog
      arrived as an unsolicited push 640ms after the last poll, and the
      post-answer state pushed too. 4 Codex rounds (2 Medium + 1 Medium
      found and fixed, final clean).
- [x] Mobile hardening round (Codex fresh-eyes sweep, 3 confirmed + 3
      round-2 findings on the fixes themselves, all fixed and re-verified):
      selector renders serialized on the shared headless terminal (two tabs'
      probes could interleave and surface tab B's dialog on tab A, where a
      tap answers the wrong prompt; timeout now disposes the pooled instance
      so a hung render can't contaminate the next); wake() liveness probe
      (iOS leaves zombie sockets that still report OPEN, so the first send
      after foregrounding vanished: queueables park until a pong proves the
      path, reads stay best-effort); Board create guard correlated by a
      server-echoed nonce (an unrelated error or a Loose Ends resume's
      terminalCreated no longer unblocks a double-tap into a second PTY),
      time-bounded at 15s for lost replies. Nonce echo live-verified on
      both reply shapes; 21 connection assertions.
- [x] Mobile chat perf + honesty batch (all live-observed 8/15):
      readTail was quadratic per 64KB chunk (whole-buffer newline recount +
      re-concat; ~0.5GB of work per call at the 8MB cap, benchmarked 10.8x
      after the fix, byte-identical on the real 93MB transcript); the chat
      poll re-shipped the full payload every 3.5s even when nothing changed
      (now a sig handshake: unchanged replies are ~190 bytes, verified live;
      client only claims a sig for non-empty payloads and the server only
      honors sigs its own socket cache has parsed, both Codex findings); and
      a session-linked chat whose Claude exited now says input goes to the
      terminal instead of "Message Claude..." (typed text executes in zsh).
      New tail-read suite: chunk boundaries, giant lines, UTF-8 straddling.
- [x] gws Reconnect actually opens the browser (Sam 8/15: "it just says
      authenticating and doesn't do anything"). Root cause: with no TTY,
      `gws auth login` prints the consent URL to stderr and waits; v1.0.61
      discarded that output. Now the URL is extracted (terminator-checked,
      Codex High: a chunk boundary mid-URL must not open a truncated link)
      and opened via shell.openExternal, the login always requests --full
      scopes (Sam: "gws should have full permissions"), and 3 seconds after
      the browser opens the panel offers a Copy link fallback because the
      default browser can open the wrong Chrome profile (Sam hit exactly
      that). 2 Codex rounds clean; live-verified in the harness end to end.

- [x] Sam's 8/14 mobile bug list (Asana 1215862050698923), all 7 items:
      1. `!` prompts no longer stick at "sending..." (echo pruner normalizes
         the `!` prefix on both sides).
      2. Messages sent mid-reconnect no longer swallowed (submitPrompt is
         queueable + the authed handler re-authorizes the tab BEFORE the
         queue flush).
      3. Multi-question AskUserQuestion popups load past question 1: raw PTY
         bytes are replayed through @xterm/headless (electron/screen-render.js)
         and the true screen is parsed (parseSelectorFromScreen), replacing
         the linear ANSI-strip regex that could not see Ink's incremental
         repaints. Live-captured 2.1.233 fixtures lock it.
      4. Raw bash commands / skill contents no longer leak into chat
         (bash-input/stdout/stderr collapsed, system-reminders dropped,
         ANSI stripped from local-command-stdout).
      5. Copy button on fenced code blocks (execCommand fallback works on
         the http origin; button sits clear of line 1).
      6. Typing `/` previews skills with descriptions + tap-to-autofill
         (new listSkills WS op; underscore plumbing dirs filtered).
      7. Terminal keys row (esc / arrows / space / enter / ^C) for
         /permissions-class TUIs, and those popups now parse via the
         emulator path too.
      3 Codex rounds; 293 unit assertions; live ship-tested on the phone
      view (copy tap observed flipping to "copied", real 3-option dialog
      answered by tap, autocomplete filtered).

## Done (shipped in v1.0.61)

- [x] Loose Ends: sessions abandoned mid-flight (interrupted / cut off
      mid-tool, idle 45m+), desktop dashboard tab AND mobile board section.
      Dismissals are activity-stamped (shared/loose-dismiss.js), so
      re-abandoned work resurfaces.
- [x] One owner per resumed session: claim/bind/release ownership in
      terminal-manager, wired through the store, mobile resumeSession, and
      auto-resume. Kills the two-claude-processes-one-transcript class
      (13 Codex rounds, 22 findings, final round clean).
- [x] Tabs stacked by attention on mobile and desktop (needs > working >
      done > idle, dormant projects auto-collapse).
- [x] Status bar no longer renders "<synthetic>" as the model (~1 in 14
      sessions) and sizes the context window off the real model.
- [x] Loose Ends accuracy audit (Sam: "did you really thoroughly look into
      that?"): new 'unanswered' ending (recovered a real lost prompt from
      12 days back), synthetic trailing rows no longer mask endings, and a
      session continued in a forked file is no longer called abandoned
      (uuid-linked, streamed scan, per-file cache).
- [x] Mobile board shows Claude's spinner word ("Cultivating…") on working
      tabs instead of flat "working" (Sam-requested; live-verified).
- [x] Terminal font picker (Sam: "friendlier font"): curated Mac monospaces
      + custom entry, live apply, always-monospace fallback. Fixed the latent
      hidden-pane 2x1 PTY squeeze every font-size change has had since
      v1.0.28.
- [x] Release hardening sweep: no CDP switch, no debug leftovers, suite run
      twice for flakes (285 x2 green), both bundles building.
- [x] Codex final release gate over the cumulative v1.0.60..HEAD diff:
      1 Medium fixed (fork-scan cache half-eviction); the version-bump
      finding is the ship-time flow working as designed.
- [x] gws account health + one-button Reconnect in Settings (Sam-requested
      after the 4/5-revoked audit): status dots, browser-approval reconnect,
      identity-mismatch fail-safes at every token consumer.
- [x] gws shim: invalid_grant explains itself and points at Reconnect.
- [x] Context meter resets on /compact via compactMetadata.postTokens
      (was stuck at the pre-compact figure until the next turn; measured
      886k shown vs 34k real for 17 minutes on a live compact).

## Done (shipped in v1.0.60)

- [x] Update Restart no longer crashes with many windows open (node-pty
      listeners disposed before kill; SIGABRT in Node teardown)
- [x] Deferred/failed install can no longer wipe the saved window list
      (persist frozen while armed; updater writer refuses an empty snapshot)

## Done (shipped in v1.0.59)

- [x] Git panels: full commit descriptions (click to expand in the Cmd+G
      panel, click for a popover in Git Tree, hover shows the whole message)

## Done (shipped in v1.0.58)

- [x] Link continued sessions: `claude --continue` tabs find their
      conversation (Brett 1217296245359720, the "No messages yet" half)

## Done (shipped in v1.0.57)

- [x] Mobile: trust the PTY not the session link for "is Claude running"
      (Brett 1217296245359720)

## Done (shipped in v1.0.56)

- [x] Mobile chat: skill/command invocations collapse to one-liners

## Done (shipped in v1.0.55)

- [x] Context meter model-aware 1M windows (branch fix/context-window)
- [x] Mobile: renamed tab labels everywhere + sessionless tab polish
      (branch feat/mobile-labels-sessionless, Asana 1217257328849820)
- [x] Mobile: interactive prompts (AskUserQuestion popup) fixed for Claude
      Code 2.1.x frames; per-tab chat drafts survive navigation; tear-off
      tab labels on the phone (feat/mobile-labels-sessionless)
- [x] Tear-off windows keep every tab across quit/update restarts
      (branch fix/update-window-restore, Asana 1217079763770509)
- [x] Sidebar Tabs view includes tabs inside tear-off windows
      (fix/update-window-restore, Asana 1217038024225884; feature itself
      shipped v1.0.44)
