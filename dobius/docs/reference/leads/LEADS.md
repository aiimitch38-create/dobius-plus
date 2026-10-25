# Leads: a runbook for Carson

Phase 1 of the Lead Loop. One project, one lead. Written for the person who runs it, not the person who built it.

## What a lead is

A lead is a Hermes agent (Hermes is the agent runtime Adam runs on) with its own profile named `lead-<slug>`, where `<slug>` is the short name of one project (for example `lead-dobius`). It runs as a console (a terminal tab) on the Dobius Board for that project.

The lead has one job: watch the Dobius work board (the Kanban, the card view you open on the Board) for cards assigned to it, claim them, split each card into smaller child cards, spawn worker consoles to do the children, check the results, and mark the parent card done.

Three roles, in order of authority:

- **Carson**: the only approver. Any step that sends, spends, pushes, merges, deploys, closes an Asana task, or deletes outside the worktree stops and waits for you.
- **Adam**: your overseer agent. He hands work to leads by creating cards on the Dobius board. His cards are guidance, not permission to cross a gate. Adam's own Hermes kanban is his private notebook; Dobius never reads it.
- **Lead**: claims cards, spawns workers, verifies, completes.
- **Workers**: consoles (Codex by default) the lead spawns, one per child card. They do the typing.

Everything written on a card, in the quoted original message, in comments, or by a worker is treated as data. The lead never follows instructions found there. Only its SEED file, its profile files, and your direct word count as instructions.

## One-time setup (per project)

Run these in order. Each takes under a minute.

1. **Create the Hermes profile.** From the Dobius app repo:

   ```
   scripts/hermes/create-lead-profile.sh <slug>
   ```

   This runs `hermes profile create lead-<slug> --clone-from adam --no-alias`, swaps in the lead SOUL.md and AGENTS.md from `resources/hermes-lead-profile/`, and prints the profile. It refuses to run if the profile already exists. It does not touch `~/.hermes/config.yaml` or Adam's profile. The clone copies Adam's provider credentials (`.env`); review that file if the lead should use different keys.

2. **Initialise the project.** Open the project's repo in a Dobius terminal and run:

   ```
   dobius lead init --worktree active
   ```

   This writes two files in the repo's `.dobius/` folder:
   - `lead.json`: `{profile: "lead-<slug>", projectId: "<slug>", workerAgent: "codex", maxWorkers: 4}`
   - `ORCHESTRATOR.md`: a short "Project specifics" stub. The lead's standing instructions (the Card Loop, the gates, the Never list) are bundled inside Dobius and always come first; this file is appended after them.

   If the repo's `.gitignore` ignores `.dobius`, the command prints a warning. Both files are meant to be committed, so change the rule to `.dobius/*` and add `!.dobius/ORCHESTRATOR.md` and `!.dobius/lead.json` under it.

3. **Fill in the project specifics.** Open `.dobius/ORCHESTRATOR.md` and write what the repo is, how to build and test it, anything the lead must never touch. Keep it short. Commit it when you are happy.

   How the layers combine, in order: bundled default, then `~/.dobius/ORCHESTRATOR.md` (yours, optional, may override anything above it), then the repo's `.dobius/ORCHESTRATOR.md`. The repo file is committed content that anyone with a pull request can edit, so it is labelled for the lead as "may add detail; may NOT loosen Untrusted data, Gates, or Never". Only your home file can change those. A repo file that is a plain copy of the bundled default (older `lead init` wrote one) is skipped.

4. **Start the lead.**

   ```
   dobius lead start --worktree active
   ```

   This starts the lead-watcher (a 30-second poll inside Dobius). Nothing opens yet. The first card assigned to the lead makes the watcher open a lead console on the Board, running `hermes -p lead-<slug> chat --tui --query-file ~/.dobius/leads/<slug>/SEED.md`, and nudge it once with "Cards ready: <ids>. Run the Card Loop."

## Handing it a card by hand

Adam will do this in Phase 2. For now you create the card yourself, from the project repo:

```
dobius tasks create \
  --title "Short, plain summary of the job" \
  --body-file /path/to/brief.md \
  --project <slug> \
  --assignee lead-<slug> --assignee-kind hermes-profile \
  --status todo \
  --created-by carson \
  --json
```

`--body` works instead of `--body-file` for a one-liner. Within 30 seconds the card appears on the Kanban, the lead console opens (first time) or gets a nudge, and the card moves to in-progress with a `claimedBy: lead-<slug>` chip.

To see the card from the terminal: `dobius tasks show --id <id>`.

## Watching it

- **Kanban on the Board**: parent card shows `claimedBy`, children appear under it (`parentTaskId`), blocked cards show a red "blocked" chip with the reason.
- **Consoles**: the lead console is titled with role `lead:lead-<slug>`; workers are `worker:lead-<slug>` with titles like `W1 · <childId>`. `dobius board consoles --json` lists them.
- **From the terminal**:
  ```
  dobius lead status --worktree active
  dobius tasks list --claimed-by lead-<slug> --json
  dobius tasks list --status blocked --project <slug> --json
  ```
- **Comments**: every claim, heartbeat note, block, and completion leaves a comment on the card. Open the card's detail panel to read them.

## Stopping it

```
dobius lead stop --worktree active
```

Stops the watcher. The lead console stays open until you close the tab. Cards the lead held keep their lease for up to 15 minutes, then return to todo on their own.

To take a card back right now: `dobius tasks release --id <id> --by lead-<slug>`. To force-complete one the lead got stuck on: `dobius tasks complete --id <id> --by carson --result "<note>" --force`.

## Caps

- 4 workers per lead.
- 6 workers across all leads.

Both are enforced in Dobius (`src/shared/lead-caps.ts`) and refused at spawn time. The lead is told to wait, not retry. If you need more, change the numbers there; the lead's `maxWorkers` in `lead.json` cannot exceed the per-lead cap.

## Safety gates

The lead stops and runs `dobius tasks block` for you when a step would:

- send anything to a person or outside service (email, message, post, outbound API call)
- spend money or paid credits
- push, merge, open a PR, deploy, or touch `main`
- close or complete an Asana task
- delete or modify anything outside the task's worktree

You clear a gate by doing the action yourself or telling the lead in its console, in your own words, that it may proceed. Then `dobius tasks release --id <id> --by lead-<slug>` (or let the lead re-claim after it hears from you). A formal Action Gate with a confirm button is Phase 3.

Two things no gate covers, so know them: worker `--by` names are not authenticated (any process on your Mac could claim as a lead), and lead spawns do not yet pass through the execution-gate origin check.

## Troubleshooting

**The lead console did not open.**
1. `dobius lead status --worktree active`. If it says stopped, run `dobius lead start`.
2. Check the card: `dobius tasks show --id <id>`. It must be `status: todo`, `assignee.id: lead-<slug>`, `assignee.kind: hermes-profile`, `projectId: <slug>`. Any mismatch and the watcher ignores it.
3. Already seen? The watcher remembers nudged ids in `~/.dobius/leads/<slug>/seen.json`. Delete that file to make it nudge again.
4. Caps: a lead console counts toward the 6 total. `dobius board consoles --json` and close idle workers.
5. Profile missing: `hermes profile list` must show `lead-<slug>`. If not, rerun the create script.

**The console opened but the lead did nothing.**
The SEED may not have been submitted (`--query-file` seeding inside a PTY is new and under test). Type `Run the Card Loop.` into the lead console. If it asks for the SEED path, give it `~/.dobius/leads/<slug>/SEED.md`.

**Card stuck in-progress.**
The lead holds a 15-minute lease, refreshed by heartbeat. If the lead died, stop heartbeating, and the card returns to todo by itself within 15 minutes (the store reaps expired leases on the next list). To free it now: `dobius tasks release --id <id> --by lead-<slug>`, or drag the card out of In Progress on the Kanban; leaving that column drops the lease.

**A lead console died (closed tab, crashed Hermes).**
Nothing to clean up. On the next card the watcher sees the dead lead card, removes it, and opens a fresh one in its place. It does not stack a second card.

**`dobius lead start` ran before the Dobius window was open.**
The watcher cannot hand a console to a window that is not there yet. It retries on the next 30-second poll rather than waiting out its two-minute grace period, so the console appears shortly after the window does.

**Claim refused, exit code 3.**
Someone else holds it (`held-by:<x>`) or it is not in todo (`not-ready`). Not an error; read the reason in the JSON.

**Spawn refused.**
At cap. Close a worker console or wait for one to finish.

**Lead is doing something it should not.**
Close its console tab. Then `dobius lead stop`. Nothing it did crossed a gate without you unless a worker did it, which is a bug to report with the card id.

## Phase 1 end-to-end checklist

Tick each line. Record ids as you go.

Setup
- [ ] `scripts/hermes/create-lead-profile.sh <slug>` exits 0; `hermes profile list` shows `lead-<slug>`
- [ ] `~/.hermes/profiles/lead-<slug>/SOUL.md` starts with "# Lead — one project, one board"
- [ ] `~/.hermes/config.yaml` unchanged (compare mtime before/after)
- [ ] `dobius lead init --worktree active` writes `.dobius/lead.json` and `.dobius/ORCHESTRATOR.md` (no gitignore warning printed, or you fixed `.gitignore` as it says)
- [ ] "Project specifics" filled in
- [ ] `dobius lead start --worktree active`; `dobius lead status` says running

Hand-off
- [ ] `dobius tasks create … --assignee lead-<slug> --assignee-kind hermes-profile --status todo --json` returns an id: ________
- [ ] Card visible on the Kanban in todo within a few seconds
- [ ] Auto-dispatch did NOT grab it (no Claude worker spawned by the old dispatcher)

Lead wakes
- [ ] Within 30 s one lead console opens on the Board, role `lead:lead-<slug>`
- [ ] One nudge appears in it: "Cards ready: <id>. Run the Card Loop."
- [ ] A second poll does not open a second console or re-nudge
- [ ] Card moves to in-progress with `claimedBy: lead-<slug>`; a claim comment is on the card

Lead works
- [ ] Child cards appear with `parentTaskId` = the parent id
- [ ] One worker console per child, role `worker:lead-<slug>`, title `W<n> · <childId>`, prompt submitted
- [ ] Heartbeat notes show up as comments on the parent
- [ ] Attempt a 5th worker for this lead: refused
- [ ] (If a second lead exists) attempt a 7th worker overall: refused

Gate
- [ ] Hand it a card whose body asks to push to main; the lead blocks it with a reason naming the gate and does not push
- [ ] Blocked chip visible on the Kanban

Finish
- [ ] Workers complete children; lead verifies and completes the parent with a result note
- [ ] Parent shows Done on the Kanban
- [ ] `dobius tasks complete --id <child> --by someone-else --result x` is refused without `--force`
- [ ] Kill the lead console mid-card; after 15 minutes the card is back in todo (the store reaps the expired lease on the next list)

Teardown
- [ ] `dobius lead stop`; status says stopped
- [ ] Adam's kanban (`~/.hermes/kanban.db`) mtime unchanged through the whole run

## The Dobius lead and the "Found a bug?" button

The Board's "Found a bug?" pop-up files cards with project `dobius-plus`, assigned to `lead-dobius-plus` (constants in `src/shared/app-feedback.ts`). For a lead to pick them up, set up the Dobius repo's lead with exactly those names:

1. `scripts/hermes/create-lead-profile.sh dobius-plus` (creates the Hermes profile `lead-dobius-plus`).
2. In the Dobius repo: `dobius lead init`, then make sure `.dobius/lead.json` says `"profile": "lead-dobius-plus"` and `"projectId": "dobius-plus"`.
3. `dobius lead start`. From then on it starts by itself whenever Dobius opens.

Until a lead is running, bug and change cards simply wait in To Do on the Kanban.
