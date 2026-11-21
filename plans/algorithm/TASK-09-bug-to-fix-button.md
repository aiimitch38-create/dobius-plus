# TASK-09: Bug-to-fix button (merges "port Report a problem" + Phase 5)
What: hotkey -> pick mode -> click element -> capture (component chain, DOM path, view, console errors, cropped screenshot, redacted logs) -> pause-crew gate -> createManagedWorktree with fix prompt -> toast when done.
Simplification: extend the existing SidebarFeedbackDialog for the note field; reuse the fiber walk from main/browser/grab-guest-script.ts:600-680; spawn via runtime.createManagedWorktree (dobius-runtime.ts:12821), shape copied from register-core-handlers.ts:138-157; component names in packaged builds via esbuild keepNames (one config line, not a plugin). One fix in flight at a time. Agent never installs or pushes.
Acceptance: in an isolated test copy, report a deliberately broken button -> a new worktree + terminal appears with the prompt naming the right component; pause crew -> refused with a message.
Estimate: 3-5 days (estimate). After-fix auto screenshot is out of scope.
