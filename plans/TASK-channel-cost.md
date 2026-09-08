# Build plan — Communications channel: cost + discipline

**Repo:** `~/Projects (Code)/Dobius/dobius-plus` (canonical — the installed
`/Applications/Dobius+.app` is built from here, verified: its asar contains the
channel prompt string).
**Baseline:** measured 2026-09-08. Channel agents burned ~$698 of a ~$1,266
24h total. 1,768 turns across **133** separate sessions.

## Already shipped (config + persona files, no rebuild — done)

| Change | Effect |
|---|---|
| Adam/Friday/Gunner `claude-opus-4-8` → `claude-sonnet-5` | ~$638/day → ~$128/day |
| `_crew/TOOLS.md` channel etiquette + truncation limit + CLI bridge | stops essay replies |
| `_crew/USER.md` TLDR rule scoped to reports | kills 290 TLDR headers |
| `Adam/rules.md` confidence scoped to decisions | kills 369 confidence scores |
| `Adam/playbook.md` written (was blank template) | triage + stop conditions |
| 33 placeholder files cleared | template text no longer injected as instructions |
| Skills + `Glob`/`Task`/`TodoWrite` granted to 3 agents | agents can work properly |

Backup: `~/.dobius/agents-backup-20260908-051729`

---

## Scope of THIS plan — 3 tasks, 1 rebuild

Ordered by payoff. Tasks 1 and 2 are small; task 3 is the only real engineering.
**Do not rebuild between tasks** — verify each with typecheck + tests, rebuild once
at the end.

### TASK 1 — Guardrail one-liners

**What.** Four edits, two files.

1. `dobius/src/main/agents/agent-runner.ts:363` — `settingSources` becomes
   `['project']` when `source === 'channel'`, `['user','project']` otherwise.
2. **Budget caps — READ THIS FIRST.** The `10` in the working tree is an
   UNCOMMITTED local change made 2026-09-07 11:52 and shipped into the
   installed app by the 21:24 rebuild. Committed values in git HEAD are far
   tighter:

   | site | git HEAD | working tree |
   |---|---|---|
   | `agent-runner.ts` `DEFAULT_MAX_BUDGET_USD` | **2** | 10 |
   | `agent-channel-service.ts` channel handler | **0.5** | 10 |
   | `agent-record-normalization.ts` heartbeat default | **0.5** | 10 |
   | heartbeat clamp ceiling | **min(2,…)** | min(10,…) |

   The 23:00 hour ($227, of which $212 channel) is the first full hour after
   that raise went live. It is NOT the sole cause — the 10:00 hour cost $254
   with the old caps — but it removed a 20x tighter ceiling on every run.

   **RESOLVED — Carson raised them because agents were burning through the $2
   limit fast.** That was correct at the time. Cost per run then vs now:

   | | 9/7 (Opus + essays) | today (Sonnet + etiquette) |
   |---|---|---|
   | cold boot | $0.69 | $0.137 |
   | 4x cache re-read | $0.22 | $0.044 |
   | output | $0.20 | $0.018 |
   | **typical run** | **~$1.10** | **~$0.20** |

   A single 232KB Adam message was ~58k output tokens = $4.35 on its own, so
   one reply could exhaust a $2 cap. That is why the caps were hit.

   The model swap and the message-length rules removed the cause, so the caps
   can come back down and become a real backstop again. **Target: channel $1,
   default $2, heartbeat $0.5.** Channel $1 is ~5x a typical run — enough that
   real work never dies mid-task, low enough to catch a runaway. Deliberately
   NOT back to $0.50, which Carson found too tight in practice.
3. `.../communications/shared/api/dobiusCommunications.ts` — NO_REPLY check
   becomes `reply.includes(NO_REPLY_SENTINEL)` instead of `===`. **TWO sites:
   line 959 (`=== SENTINEL`) and line 1812 (`!== SENTINEL`).** Fixing only one
   leaves the leak half-open.
4. `dobiusCommunications.ts:817` — `MAX_AGENT_CHAIN_DEPTH` 8 → 3.

**Why.**
1. Measured A/B: `--setting-sources user,project` = 39,705 tokens; `project`
   only = 29,799. **9,906 tokens saved per session boot.** Safe to drop because
   hard-rail hooks are set explicitly in code (`buildAgentHardRailHooks`), and
   skills are now named per-agent rather than discovered from `~/.claude`.
   Bonus: stops the global learn-hook firing inside chat agents.
2. $10/run x 133 runs = a $1,330/day ceiling. That is not a cap.
3. Agents wrap the sentinel in prose ("staying quiet [[NO_REPLY]]"), it fails
   exact-match, gets posted, and wakes another agent. Observed 23:20 -> 23:23
   costing a full Adam turn, and again at 04:42.
4. Backstop once task 2 lands.

**Test.**
- `pnpm run typecheck` exits 0.
- `pnpm test` exits 0.
- Post in the channel, confirm an agent that should stand down posts nothing.
- Re-measure boot tokens; expect ~29-30k, down from ~39.7k.

**Risks.** Dropping `'user'` also drops `~/.claude/CLAUDE.md` from agent context.
Agents lose Carson's global house rules. **Mitigation:** the parts that matter
(voice, safety, tool conventions) are already in `_crew/USER.md` and
`_crew/TOOLS.md`, which load from the agent identity path, not settingSources.
Verify an agent still refuses to send email / close Asana after the change.

**Estimate.** 20 min.

---

### TASK 2 — One message should wake one agent

**What.** In `dispatchMessageToDobiusAgents` (`dobiusCommunications.ts` ~line
878): for human-authored messages, if the message names any channel agent
(bare name or `@name`), target only those agents. If it names none, keep the
current broadcast behaviour.

Extend `contentMentionsAgent` to match a bare name at a word boundary, not just
`@name` — Carson types "adam", not "@Adam".

**Why.** Today membership alone wakes every agent for a human message; the
`@mention` requirement applies only to agent-authored messages. One word from
Carson starts four sessions. This is the largest remaining multiplier.

**Test.**
- Unit test on the matcher: "adam" matches Adam; "adamant" does not; "@Friday"
  matches Friday; "hey team" matches nobody (broadcast preserved).
- Live: type "adam" in the channel, confirm exactly one run starts
  (`dobius agents runs`).

**Risks.** A bare-name matcher can over-match common words. Keep it to
word-boundary, case-insensitive, and only for names >= 4 chars. Broadcast must
still work when no name appears, or the channel stops feeling like a room.

**Estimate.** 45 min including the test.

---

### TASK 3 — Stop cold-booting every reply

**What.** `agent-runner.ts:281`. Today `sessionKeyBusy` disables resume whenever
another run for the same (agent, sessionKey) is in flight, so a busy channel
never reuses a session. Replace "start fresh" with "queue": serialize runs per
(agent, sessionKey) so the second message waits for the first and then resumes
the same session.

**Why.** 133 sessions in 24h where the design intends roughly one per channel
per agent. Each cold boot is ~36.5k tokens (~29.8k after task 1). Median session
is 4 turns; half die in <= 4. This is the difference between paying the boot once
per conversation and paying it once per sentence.

**Test.**
- Fire three channel messages at one agent back to back; confirm one session id
  in `~/.claude/projects/`, not three.
- Confirm no transcript corruption (two writers) — the queue is what prevents it.
- Re-run the session-count measurement over 24h; expect single digits.

**Risks.** Highest of the three. A queue can deadlock or strand a run if a turn
never completes. Needs a timeout that falls back to a fresh session rather than
hanging the channel. The existing `sessionKeyBusy` guard exists for a real
reason — two writers on one transcript — so do not simply delete it.

**Estimate.** 2h. Own commit, own review pass.

---

## Pre-flight (blocking)

1. **Someone else's work is in the tree.** Branch `feat/buzz-terminal-skin`, 20
   dirty files including `agent-runner.ts` (1 line) and
   `agent-channel-service.ts` (1 line). Neither touches the lines above, but a
   rebuild bundles their half-finished code. **Confirm with Carson before
   building.** Do not stash — the stash stack is shared.
2. Branch from current HEAD: `git checkout -b fix/channel-cost`. Commit only the
   files this plan names.
3. `pnpm run typecheck` must exit 0 *before* starting.

## Verification gate (every task)

```
pnpm run typecheck     # tsgo x3 configs — bare `npx tsgo` does NOT work here
pnpm test              # vitest
pnpm run lint          # oxlint + gates
```

## Build + install (once, after all three)

```
DOBIUS_REPO="$HOME/Projects (Code)/Dobius/dobius-plus" \
  bash ~/.claude/skills/dobius-build-install/scripts/install.sh
```
The skill's script still defaults `DOBIUS_REPO` to `~/DobiusPlus`, which does
not exist on this machine — the override above is required.
**The app relaunches itself and will interrupt open windows.** Get Carson's OK.

## Done bar

- [ ] typecheck + test + lint exit 0
- [ ] `code-reviewer` subagent run, findings applied
- [ ] boot tokens re-measured, ~29-30k confirmed
- [ ] session count re-measured over 24h, single digits
- [ ] channel spend re-measured; target < $60/day all-in
- [ ] Carson merges (never Claude)

## Explicitly out of scope

- MCP write grants (Gmail send, Telegram post, Drive share) — needs Carson's
  decision on blast radius, not a code task.
- Duplicate relay pubkeys (Adam x3, Friday x2, Gunner x2) — data cleanup.
- Empty `brief.md` for every agent — content, not code.
- 20+ orphaned `claude` processes; unbounded `progress-log.md` growth — hygiene.
- Voice Conductor still on `opus` — one config edit, decide separately.
