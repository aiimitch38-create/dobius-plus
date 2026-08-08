# Dobius+ standing backlog

Maintained by the machine (/start-dobius-plus-machine). Checked items name
the version or branch that shipped them. Sam triggers releases.

## Queue

- [ ] Selector-parser accepted residuals (revisit only if Sam reports ghost
      popups): answered AskUserQuestion + <=3 indented response lines briefly
      reads live; a rule row after the footer reads live (boxed-prompt border
      is the same shape, locked by test 27).

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
