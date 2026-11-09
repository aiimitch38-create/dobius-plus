# Dobius Vision

Carson's own words, captured 2026-11-08/09 so this survives context resets. This is
the north star — read it before any work that touches scope, architecture, or what
Adam is allowed to do. If a feature decision conflicts with this, flag it rather
than silently picking a side.

## What Dobius is

Dobius is not "a terminal wrapper with an AI feature." It is the **central
workstation** — the heart/brain — that every one of Carson's businesses and
projects runs through. Individual businesses get their own dashboards; Dobius is
what drives and connects all of them. If Dobius doesn't work, the businesses it
drives don't make money. This is the main thing, ahead of everything else.

It is also meant to be a **creative studio**: a place to create and do multiple
things at once, with agents doing multiple things at once, and the ability to see
all of it happening.

It must be genuinely easy for a complete beginner to open and use — "meant for
anyone that has no clue what they're doing" — while having enough depth
underneath that a power user never outgrows it. Simple on the surface, powerful
underneath.

## Adam: not a feature, a presence

Adam is not a chatbot bolted onto the app. He is a **personal AI agent with his
own presence** inside Dobius — his own body (the orb/face), his own voice, his
own cursor. You have live conversations with him like a person.

He operates on two tracks at once:
- **Foreground**: brought to the front so Carson can watch him work, when asked.
- **Background**: working on other things while Carson does something else —
  "like he has his own mouse," clicking through screens Carson isn't looking at.

He has been given permission to **propose and write changes to his own
codebase** (Dobius itself) — a deliberately uncomfortable line Carson crossed on
purpose, with guardrails (propose → review → approve, not write-and-ship).

## Multi-channel command center

All of Carson's channels — iMessage, email, business and personal accounts,
whatever matters — should be visible and actionable from inside Dobius, with
agents able to filter and act on them. The goal: everything a person needs to
track day-to-day to operate at their highest output, with AI agents doing the
busywork of watching and triaging it.

## Agents as job descriptions

Agents are set up like jobs: a job description, what they're responsible for,
what accounts/tools they have access to. Dobius already has the bones of this
(custom agents with scoped tool access) — the vision is to go further: more
structured roles, more channels wired in, more agents running concurrently with
full visibility into what each is doing.

This scales up through levels:
1. Single agents with a defined job.
2. **Orchestration** — one agent directing several others on a task.
3. **Swarms** — many agents working a problem together.
4. **Departments** — swarms organized by function (not yet defined in detail;
   revisit when orchestration and swarms are solid).

## Self-evolving system (Laya)

Dobius should learn over time, not stay static: how Carson works, how agents
behave, and where verification keeps failing across agent processes. This is
**Laya** — Dobius's advisory model service (see `DOBIUS-SYSTEM.md` §10) — grown
from a task-router into a standing learning layer. As of the 2026-10-24
decision Laya existed only as source, not activated; this vision extends its
job once it is.

**Decision (2026-11-09): split by risk level**, same trust boundary as Adam
editing his own code:
- **Low-stakes patterns** (e.g. reordering a checklist, tweaking a prompt
  wording, adjusting a non-destructive default) can be applied automatically
  once Laya is confident.
- **Anything touching permissions, sends, spend, or agent instructions/scope**
  needs Carson's approval first — Laya surfaces the pattern ("you always
  reject X," "this verification step fails 40% of the time"), Carson decides.

**Open: where the line between "low-stakes" and "needs approval" actually
sits** — not yet enumerated. Define concrete examples before building the
auto-apply path, so "low-stakes" doesn't quietly expand into something that
should have needed sign-off.

## Herald OS: where Adam's full autonomy is headed

[Herald OS](https://github.com/iamlukethedev/Herald-OS) is an independent
open-source project (by a developer going by "Luke The Dev" — not affiliated
with Carson, Dobius, or Nous Research) that wraps **Hermes Agent**, the
open-source agent runtime from Nous Research. Herald OS takes that engine and
gives it the *whole screen*: it opens apps, manages files, runs scheduled
routines, and does full computer-use, all behind a permission system.

This matters because **Dobius's own "Hermes harness" (Adam's brain) already runs
on the same Hermes Agent engine** — `adam-hermes-runtime.ts` and
`hermes-desktop-rpc.ts` spawn the same `hermes_cli` / `tui_gateway` process
Herald OS uses. Adam and Herald OS are cousins: same engine, different body
(Dobius's board/windows vs. Herald OS's full desktop takeover).

**Decision (2026-11-09): actually integrate, not just take inspiration.** Adam's
path to full-desktop computer-use should route through Herald OS's existing
full-screen agent-native capability rather than rebuilding that layer from
scratch inside Dobius. Concretely:
- Investigate how `herald-os-bridge` (`~/.hermes/plugins/herald-os-bridge`) is
  structured, since this is already the pattern Hermes uses to expose
  system-level tools to the agent.
- Scope what "integrate" means in practice before building anything: does Dobius
  shell out to Herald OS for desktop-wide actions, run alongside it, or
  something else? This has not been decided yet — only the direction (yes,
  integrate) has.

## Open / not yet decided

- The exact shape of "departments" in the orchestration hierarchy.
- The concrete integration mechanism with Herald OS.
- Which channel integrations (iMessage, email, etc.) come first.
- Where the line sits between Laya patterns that auto-apply vs. need approval.

## How to use this doc

- Before scoping new Adam/orchestration/channel work, check it doesn't
  contradict this file.
- When a vision decision gets made or changes, update this file in the same
  session — don't let it drift stale.
