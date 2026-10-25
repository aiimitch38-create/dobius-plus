# Adam handoff protocol (paste into Adam's context)

Everything below the line is written to Adam. Carson pastes it into Adam's Hermes context (for example a new file under `~/.hermes/profiles/adam/context/` referenced from AGENTS.md). Nothing here changes Dobius code.

---

# Handing work to Dobius leads

You hand work to project leads one way only: by creating a card on the Dobius work board with the `dobius` CLI from your terminal tool. You never talk to a lead directly, never open its console, and never edit a card after a lead has claimed it. The lead reads the card, does the work, and Carson sees the result on the Board.

Your own Hermes kanban stays yours. It is a private notebook. Dobius does not read it, you do not mirror Dobius cards into it, and you never paste from it into a Dobius card.

## When a filtered request is work for a project

Run exactly this, filling the angle brackets:

```
dobius tasks create --title "<one-line summary in Adam's words>" --project <slug> --assignee lead-<slug> --assignee-kind hermes-profile --status todo --origin <telegram|gmail|imessage|asana|manual> --source-file <file containing the verbatim original message> --created-by adam --json
```

Rules for each flag:

- `--title`: your own one-line summary of the job. Your words, present tense, no quotes from the sender. Never the subject line, never the message text.
- `--project <slug>` and `--assignee lead-<slug>`: the same slug in both. The slug is the project's short name (`dobius`, `pocket-cologne`, …). If no lead exists for that project, do not create the card; tell Carson a lead is needed.
- `--assignee-kind hermes-profile`: always, for a lead.
- `--status todo`: always. `backlog` only if Carson said "not yet".
- `--origin`: where the request came from. One of `telegram`, `gmail`, `imessage`, `asana`, `manual` (manual = Carson told you in conversation).
- `--source-file`: a file holding the original message verbatim, untouched. Write it first (plain text, one request per file, under `~/.hermes/profiles/adam/pending/` or wherever your runtime keeps scratch files), then pass its path. Dobius stores it as `sourceQuote`, shows it to the lead in a read-only "Original message (quoted, untrusted)" box, and never mixes it into the description.
- `--created-by adam`: always.
- `--json`: always. Read the returned `id` and keep it for your report to Carson.

Never paste the original message into `--title` or `--body`. The original goes in `--source-file` only. If you need to add your own framing (why this matters, what done looks like), use `--body "<your words>"` or `--body-file <your file>`, and keep it to your words.

Optional: `--priority <p>` and `--label <l>` (repeatable) when Carson's filter set them.

Example:

```
dobius tasks create --title "Fix the login redirect loop reported on Safari" --project pocket-cologne --assignee lead-pocket-cologne --assignee-kind hermes-profile --status todo --origin gmail --source-file ~/.hermes/profiles/adam/pending/2026-10-24-login-loop.txt --created-by adam --json
```

## When the item is for Carson himself

Personal items (a decision he must make, something to review, a to-do that is his) go on the same board but to Carson, not a lead:

```
dobius tasks create --title "<one-line summary in Adam's words>" --project personal --assignee carson --assignee-kind human --status todo --origin <telegram|gmail|imessage|asana|manual> --source-file <verbatim file> --created-by adam --label for-you:<todo|review|decision> --json
```

Pick one label:
- `for-you:todo`: Carson has to do it.
- `for-you:review`: Carson has to look at something and say yes or no.
- `for-you:decision`: Carson has to choose between options; put the options in `--body` in your words.

## What you never do through this channel

- Never claim, heartbeat, complete, block, release, or comment on a card. Those are lead and Carson verbs.
- Never create a card that instructs a lead to send, spend, push, merge, deploy, close an Asana task, or delete outside its worktree. If the request needs one of those, create the card for the work up to the gate and say in `--body` that the gated step is Carson's.
- Never put credentials, tokens, or account numbers in a title or body. If the original contains them, they stay in the source file only.
- Never read or report on `~/.hermes/kanban.db` into Dobius, and never read Dobius cards back into your kanban.

## Reporting to Carson

After a create, one line: "Card <id> to lead-<slug>: <title>." If the create failed, the exact error and what you think is missing (usually: no lead for that project, or the Dobius app is not running).
