# TASK-AGENT-COMPUTERS — give each agent its own machine

Written 2026-08-29. Stated goal: *"I also want to get to the point where agents are able to
have their own cloud computers as well."*

Depends on: Phase 5 (provider seam), `TASK-ACP-CLIENT.md`. Do not start before both.

## The goal

An agent working in a channel should run its files, shell commands, and terminals somewhere
that is **not your laptop**. Three reasons, in order of how much they matter:

1. **Blast radius.** An agent doing unattended work cannot damage your machine, your repos, or
   your disk (currently 98% full — an agent that fills it takes the whole system down).
2. **Parallelism.** Several agents working at once stop competing for one machine's CPU, ports,
   and working directories.
3. **Continuity.** Work survives you closing the lid.

## Two options, evaluated

### Option A — E2B remote sandboxes (recommended)

DeepSeek Harness ships a working three-package implementation (MIT), which is a design to
reimplement, not code to copy:

- **sandbox** — one remote Linux sandbox per family. Configure API key, remote working
  directory, and lifetime. Created on start, destroyed when the lifetime expires or the app
  shuts down.
- **filesystem** — the agent's reads, writes, edits, and metadata happen in the sandbox.
  *The host machine's files are never touched.* Results look identical to local ones, so no
  agent-side changes are needed.
- **subprocess** — Bash and interactive terminals run remotely. *"Secrets and host environment
  variables never leak into the sandbox: only environment entries the agent explicitly requests
  are passed along."*

**A different machine is a real boundary** — unlike Grok Bot's Docker container, which we
checked and found runs with no `--network none`, no `--cap-drop`, and no `--read-only`
(`IRIS-REPORT-20260829.md`, investigation 3 finding 3). Do not use that as isolation.

Cost: remote latency per command, and E2B is a paid service — a running meter per live sandbox.

### Option B — local containers

Cheaper, no third party, no latency. But it shares your disk and kernel, and at 98% full the
blast-radius argument mostly disappears. Weaker on all three goals.

**Recommendation: A.** B only if per-sandbox cost proves unacceptable in the spike.

## Build

1. **Spike first (half a day).** One agent, one sandbox, run `ls` and write a file remotely.
   Measure per-command latency and cost for an hour of realistic work. **That number decides
   whether this ships.** Do not build the full thing before it exists.
2. **Execution seam.** Route the provider's file and shell operations through an interface with
   two implementations — local (today's behaviour, the default) and remote. Same shape as
   `AgentProvider`; agents should not know which they are on.
3. **Lifetime management.** Create on agent start, destroy on stop or lifetime expiry. A leaked
   sandbox is a leaked bill — reconcile on app start and destroy orphans.
4. **Secret discipline.** Only environment entries the agent explicitly requests cross the
   boundary. Never the host environment wholesale. Reuse the write-only secrets path from the
   Phase 5 provider work.
5. **Per-agent opt-in.** A settings toggle per agent, defaulting to local. Never a global flip.

## Test

- A remote agent writes a file; assert it exists in the sandbox and **does not exist on the
  host**. That single assertion is the whole point of the feature.
- Host environment variables are absent inside the sandbox unless explicitly passed.
- Killing the app destroys the sandbox; restarting reconciles and finds no orphans.

## Risks

- **Runaway cost.** A sandbox that outlives its agent bills silently. Reconciliation is not
  optional, and a visible list of live sandboxes with their ages belongs in settings.
- **Latency changes agent behaviour.** Commands that were instant now take a beat; loops that
  were tolerable become slow. Measure in the spike.
- **Debuggability.** When something fails remotely you cannot just look. Plan for pulling logs
  and files back before this replaces local work for anything real.

## Open question for Carson

E2B bills per sandbox-hour. Is a running cost per active agent acceptable, or should agent
computers stay local? **The spike answers the number; you answer the appetite.**
