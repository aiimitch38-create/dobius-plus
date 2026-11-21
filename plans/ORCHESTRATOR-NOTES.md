# Orchestrator notes

Running notes from Claude 5 while orchestrating the board consoles (Plan 2, Build 2, Test 2, Docs 1).
Carson asked (2026-11-21): "if you notice anything ... that needs to be improved ... quicker, faster, more efficient, cheaper ... take notes as you work."
Newest at the bottom. Each note: what happened, why it costs time or money, the suggested fix.

## 2026-11-21

1. **Finding my own board took about 10 commands.** The command line has no board command, terminal titles are not card names, and the card-to-terminal link lives only in the app window and its saved file. Fix: Phase 9 items 9.1-9.3 (`dobius board list`, send by card name, each console knows its card name). Biggest time saver on this list.

2. **Terminal addresses change constantly.** They changed between two lookups one minute apart, and again on every console restart. Every hand-off needs a fresh lookup by tab. Fix: 9.4 / 9.7 (a stable address per card).

3. **Agents quit after finishing, so the board looks "off".** After sending its done report, each agent exited back to a plain shell. Restarting it from the orchestrator was blocked (launching in skip-permissions mode counts as weakening oversight), so Carson had to restart each card by hand. Fix options: (a) keep the agent session open after a done report instead of exiting; (b) a "Restart agent" button on the card; (c) an allowlisted relaunch command for the orchestrator. (a) is cheapest.

4. **A closed card is invisible to the command line.** Docs 1's card stayed on the board after its terminal closed, and the saved board file lagged behind its new tab. Fix: 9.5 (honest "not running" badge) and saving the board right after a card's tab changes.

5. **Every task brief repeats the same ~25 lines of rules.** That is paid for in tokens on every hand-off. Fix: let `dobius orchestration task-create` take a shared context file (`--context-file`) that the preamble includes once per session, not per task.

6. **I cannot see or choose each card's model.** Plan 2 and Docs 1 turned out to run Haiku 5.5. Fine for docs, risky for planning and building. Fix: show the model on each card, and allow per-label defaults (Plan/Build = top model; Docs/screenshot work = Sonnet or Haiku, which also cuts cost; matches the capture-agents-use-sonnet rule).

7. **Child copies are made and merged by hand.** For each worker I create a worktree, link the shared packages, then review and merge it back. Fix: `dispatch --worktree-from <branch>` that creates the child copy (with the package link) and a `merge-back` step. Saves ~4 commands per task and removes a whole class of mistakes.

8. **The wait-for-results output is awkward to read.** `check --wait` prints heartbeat lines mixed with the final JSON, so scripts trip on it. Fix: a `--quiet` flag or one-JSON-per-line output.

9. **Recurring tool traps that cost retries:**
   - `vitest` without `--config config/vitest.config.ts` picks the old root config and fails to start. Fix: a root `pnpm test:dobius <paths>` script.
   - `git branch -d` says "not fully merged" when the branch IS merged into WORKSTATION-BUILD, because it compares against the main checkout's branch. Fix: check with `git rev-list --count <base>..<branch>` (now my habit).
   - zsh does not split a `$VAR` file list into separate files. Fix: use arrays or `bash -c`.
   - Committing while other files were staged swept unverified code into a plan commit once (caught and split). Fix: always `git commit <paths>` or check `git diff --cached` first.

10. **What worked well, keep doing it:** background `check --wait` costs nothing while workers run; verifying each worker's key claim myself (test counts, duplicate files) caught nothing wrong but made every merge safe; one task per console with separate files meant zero merge conflicts.
