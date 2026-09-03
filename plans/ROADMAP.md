# Dobius+ Communications & Agent Runtime — roadmap

Index of every plan written 2026-08-29. Evidence for all of it: `IRIS-REPORT-20260829.md`
(four investigations).

## The goal

**Channels are work queues by job type.** Split work into channels, agents work in them,
coordinate with each other, and handle what does not need your attention. Later, each agent gets
its own computer. The hub is a place to delegate and watch work happen — not a nicer chat window.

## State today (verified 2026-08-29)

- Backend: 28,806 lines, verification gate 21/21 green, relay live on 127.0.0.1:3300.
- Comms Phases 0–4 committed (`41b274fb`, `7eaf8bbf`, `fdcffaaf`). Phase 5 written, **uncommitted**.
- **Nothing pushed.** Every comms commit exists only on this laptop.
- Communications UI is a 1,333-line stub: DMs only, no roster, no calls, no templates.
- Disk at 98% (5.1 GB free) — a known cause of silent corrupt builds in this repo.

## Plans

| Plan | Covers | Status |
| --- | --- | --- |
| `TASK-COMMS-BUILD-PLAN.md` | **The critical path.** Phase 5 (provider seam), 5.5 (restore the Buzz UI + rebrand), 6 (gateway/policy/audit), 7 (prove live, ship). Acceptance test lives here. | ready |
| `TASK-ACP-CLIENT.md` | Fix the false "ACP-speaking CLI" claim in our UI, then implement a real ACP client so any standard agent plugs in. | ready |
| `TASK-AGENT-RUNTIME-HARDENING.md` | Conversation compaction, tool-result pruning, repeat-call detection, tool timeouts. Applies to every agent we run. | ready |
| `TASK-COMMS-P8-ADDITIONS.md` | Eight Grok Bot ideas. Three amend Phase 6 for free (audit taxonomy, shadow mode, permission fencing); five are later features. | ready |
| `TASK-AGENT-COMPUTERS.md` | Agents running on their own remote machines. | blocked on Phase 5 + ACP |
| `TASK-COMMS-MASTER-PLAN.md` | Original Phases 0–7. Phases 0–4 are history; 5–7 superseded by the build plan. | historical |
| `TASK-COMMS-P5B-GROKBOT-UI.md` | Superseded by the build plan. | **stale — delete** |

## Order

1. **Push the branch.** Three weeks of work, one disk, no backup.
2. **Free disk space.** 5.1 GB will not survive ~14 new dependencies plus an Electron build.
3. **Phase 5** — commit the provider seam, add OpenRouter, add the path guard. (~½ day)
4. **ACP step 1** — fix the copy that claims a protocol we do not speak. (minutes)
5. **Runtime items 3 + 4** — repeat detection, tool timeouts. Small, ship with Phase 5.
6. **Phase 5.5a spike** — restore the tree, swap router history, typecheck. **The error count is
   the estimate.** Under ~200 continue, over ~500 stop and reconsider.
7. **Phase 5.5b/c/d** — compile, rebrand, prove. (3–5 days)
8. **ACP step 2** + **Runtime items 1 + 2** (compaction).
9. **Phase 6** — gateway, policy, audit, amended by P8 Part A.
10. **Phase 7** — prove live, then the Done Bar.
11. **Agent computers**, then the remaining P8 features.

**Estimate to a working hub: 7–10 working days**, gated on the 5.5a number.

## Open questions

- E2B bills per sandbox-hour. Acceptable running cost per active agent, or keep computers local?
- Memory synthesis costs one model call per sweep per agent — acceptable?
- Teach recording: does computer-use v2 give an isolated capture surface, or would it record the
  live desktop? (Decides whether it needs a consent gate.)
- Does our approval bridge invalidate approvals across account switch?
- Do we pass raw agent transcript text into another agent's prompt anywhere?

## Not in any plan, but real

- **Dobius+ crashes on extended ⌘E voice use** — reported, reproducible, untouched. A daily-use
  bug outranking a two-week feature.
- **The ElevenLabs key** is still blocking the voice work.
