# Weekly skill cleanup (plan item 8.17): research and design

Status: research only. No files were deleted or changed. Output is suggestions only.
Plan source: plans/WORKSTATION-BUILD-PLAN.md, "Plan: weekly skill cleanup (8.17)".

Key terms, in plain English:
- **Skill** (a saved playbook Claude can run): a folder with a `SKILL.md` file.
- **Slash command** (a shortcut typed as `/name`): a single `.md` file in a `commands` folder. Skills and commands both show up in Claude's skill list.
- **Hash** (a short random-looking code): here, an 8-character id that makes each file name unique.
- **Trigger eval** (a test of whether a skill fires): skill-creator sends sample phrases to Claude and checks which skill runs.

## Summary

The 10 duplicate `subagent-prompt-engineer-skill-<hash>` entries are not in `~/.claude/skills`, as the plan guessed. They are **in `~/.claude/commands/`**, and they are byte-for-byte identical. They were written by the trigger-test script in the skill-creator plugin. That script is supposed to delete its file after each test, so these 10 are leftovers from a run that was cut off. The fix is to stop the leak. Cleanup itself should be a weekly report that suggests changes, and Carson approves each one.

The old decision log said "0 matches in ~/.claude/skills, location unverified" (`plans/algorithm/DECISIONS.md:79`). That is now resolved: the location is `~/.claude/commands`.

## Findings

### 1. Where the duplicates come from

**Verified: the 10 files.**
- `~/.claude/commands/subagent-prompt-engineer-skill-{1d783f4d,297bf985,37e6b940,5f86be2f,622c4658,6a2a9818,95c35d6a,b15b46a0,baf715f2,e326c282}.md`.
- All 10 have the same MD5 (`87ad2ab837c26dc0e7217b1a05e11bdb`). All 10 have the same modified time: 2026-07-09 22:24 local.
- `~/.claude/commands` holds only these 10 files.

**Verified: the writer.** The plugin `skill-creator@claude-plugins-official` (installed version `f59aa2e6dd7d`, path `~/.claude/plugins/cache/claude-plugins-official/skill-creator/f59aa2e6dd7d/`) contains `skills/skill-creator/scripts/run_eval.py`:
- Line 51-52: `unique_id = uuid.uuid4().hex[:8]` then `clean_name = f"{skill_name}-skill-{unique_id}"`. This is the hash in the name.
- Line 53-54: the file goes to `<project_root>/.claude/commands/<clean_name>.md`.
- Line 181: `command_file.unlink()` runs in a `finally` block, so the file should be removed after each test.
- Line 198: a `ProcessPoolExecutor` runs several tests at once. Each one writes its own file, so a run with 10 workers writes 10 files at the same moment. This matches the 10 identical timestamps.

**Verified: why the files land in the home folder.**
- `find_project_root()` (lines 22-33) walks up from the current folder looking for a `.claude` folder. The home folder `/Users/bayou` has `.claude`, so any run started from a folder without its own `.claude` ends up writing to `~/.claude/commands`.

**Inferred: when and how it happened.**
- Carson's prompt history shows a run at 22:13:33 on 2026-07-09 about "Trigger-optimization ... for a fire every time I say subagent skill" (`~/.claude/history.jsonl`). The files were written at 22:24, 11 minutes later. This fits a trigger-optimization run started from home.
- The 10 files still exist, which means the `finally` cleanup did not run. The likely cause is that the run was killed hard (for example, the terminal closed or the process was force-stopped) before cleanup. This is not proven. Nothing in the logs records how the run ended.

**Verified: the plugin is third-party code.** It lives under `plugins/cache`. Plugin updates overwrite that folder, so do not patch it in place.

### 2. Inputs for the weekly report

**Verified, all three exist:**
- `~/.claude/skills/LEARNED.md` (20,988 bytes, updated 2026-11-13). The index of learned skills.
- 73 folders named `~/.claude/skills/learned-*/SKILL.md`. This matches the plan's "73 learned skills".
- `~/.claude/algorithm/command-log.tsv`: 72,831 lines. Each line is `unix_time<TAB>folder<TAB>command`. The newest line is from 2026-11-21 13:18 local.
- `~/Obsidian Vault/AI Research/Inbox/`: 44 files matching `Sessions*.md`. Newest is `Sessions 2026-11-21.md`.

**Verified: other skill inventory.** `~/.claude/skills` holds 217 entries. The duplicates count as one kind of waste; the report should also flag identical folders by hash (see Task S2).

### 3. Where the weekly run would live

**Verified:** `dobius/src/main/automations/` exists and is the place for scheduled Dobius jobs. Its exact scheduler API was not read in this pass.
**Inferred:** the report should be produced by a read-only agent run or a plain script, then written to the Inbox as a note and to the Kanban board as one card.

## Recommended design

1. **Stop the leak first (S1).** Run skill-creator trigger tests only from a folder that has its own `.claude` folder, so commands land there and not in home. Nothing in the plugin needs to change.
2. **Clear the 10 leftovers only with Carson's OK.** They are identical and unused, but deleting them is a change outside the repo, so it waits for approval.
3. **Weekly report, suggestions only.** A script (or read-only agent) reads the three inputs above and writes one markdown report with four sections: duplicate folders (by hash), skills with no use in 30 days (from `command-log.tsv`), patterns in `LEARNED.md` that look like merge candidates, and suggested new skills from repeated commands.
4. **Approval gate.** Each suggestion is a line with a checkbox. Carson approves; the skill-creator drafts a new skill only after that.
5. **Nothing is deleted by the job.** Enforced in code: the job has no delete call.

## Task list

| # | Task | Files | Size |
|---|---|---|---|
| S1 | Document and run skill-creator trigger tests from a folder with its own `.claude` (no code change) | new note in `~/.claude/skills/skill-creator/` is out of repo; put the rule in the repo's README-style note | S |
| S2 | Duplicate finder: group `~/.claude/skills` and `~/.claude/commands` by MD5, report groups | new script in `dobius/scripts/` or a read-only automation step | S |
| S3 | Usage finder: count skill names in `command-log.tsv` and `LEARNED.md` for the last 30 days | same script as S2 | M |
| S4 | Report writer: one markdown file to the vault Inbox plus one Kanban card | `main/automations/` (new job file), `main/ipc/vertex-tasks.ts` (reuse create) | M |
| S5 | Weekly schedule | `main/automations/` scheduler (API not read) | S |
| S6 | Clean the 10 leftovers | `~/.claude/commands/subagent-prompt-engineer-skill-*.md` | S, needs OK |
| S7 | Tests: duplicate grouping on fixture folders; job has no delete path | new test files next to the script | S |

## Open questions for Carson

1. May I delete the 10 leftover command files? (They are identical and unused. I will not delete without your OK.)
2. Should the report go to the vault Inbox, the Kanban board, or both? (The plan says both.)
3. Should the weekly job be a Dobius automation (in the app) or a launchd job (outside the app)?
4. Is 30 days the right window for "unused"?
5. Should the duplicate finder also cover `~/.claude/plugins` (plugin copies can be duplicates too)?
