# Dobius+ standing backlog

Maintained by the machine (/start-dobius-plus-machine). Checked items name
the version or branch that shipped them. Sam triggers releases.

## Queue

- [ ] Asana 1217079763770509 "Fix updating": two windows on the SAME project
      collapse to one after an update restart. Verify computeRestoreLists /
      lastOpenProjects dedupe-by-path and make duplicate-project windows
      restore (Sam runs two b2b-portal windows daily).
- [ ] Asana 1217038024225884 (sidebar tabs list): verify the shipped
      getAllProjectTabs sidebar covers the ask, post evidence comment.
- [ ] Selector-parser accepted residual: answered AskUserQuestion with <=3
      indented response lines briefly reads as live selector (documented in
      selector-parser.js). Revisit if Sam reports ghost popups.

## Done (stacked, awaiting release)

- [x] Context meter model-aware 1M windows (branch fix/context-window)
- [x] Mobile: renamed tab labels everywhere + sessionless tab polish
      (branch feat/mobile-labels-sessionless, Asana 1217257328849820)
