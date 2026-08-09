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
