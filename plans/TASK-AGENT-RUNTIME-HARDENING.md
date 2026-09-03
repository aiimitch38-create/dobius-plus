# TASK-AGENT-RUNTIME — compaction, tool safety, loop hardening (Dobius-wide)

Written 2026-08-29. Sources: `IRIS-REPORT-20260829.md` investigation 4;
`github.com/deepseek-ai/deepseek-harness` (MIT). Designs reimplemented, not copied.

Not communications-specific. This is runtime behaviour for **every agent Dobius+ runs**.

## The honest boundary — read first

"Dobius-wide" has a hard edge, and pretending otherwise would waste days:

| Surface | Can we control it? |
| --- | --- |
| Agents launched through the `AgentProvider` seam (Claude SDK, Codex, custom harness, OpenRouter) | **Yes — fully.** Everything below applies. |
| Agents driven over ACP once that lands | **Yes.** We are the client; we own the context. |
| Terminal tabs running the `claude` / `codex` CLI | **No.** Those binaries manage their own context internally. We cannot inject compaction into another program's memory. |

For terminals we own the environment, the PTY, and the hooks — not the context window. The
realistic win there is item 4 (timeouts) and the existing failure-learning hooks, not compaction.

**So "every agent" means every agent Dobius+ itself runs.** That is the harness, the
communications channel agents, and anything ACP — which is exactly the fleet the channel-based
work plan depends on.

## Current state (verified)

Dobius+ has **no conversation compaction whatsoever**. A search for compaction or summarisation
across `src/main` returns one file, `github/conflict-summary.ts` (225 lines), which summarises
git merge conflicts. Unrelated.

No repeat-call detection. No tool-call timeout policy at the provider layer.

---

## Item 1 — Tool-result pruning (do this first)

**The highest-value piece, and the answer to "compacted but still knows what we were saying."**

What fills a context window is tool output — file dumps, command output, search results — not
conversation. Naive compaction summarises everything including your words, which is why agents
come back vague.

Instead: when pressure builds, trim each **over-budget tool result** to a bounded head, a
`…middle pruned…` marker, and a bounded tail. The conversation itself is never touched.

- **No model call.** Instant and free.
- **Often relieves pressure alone**, so summarisation never runs and the conversation survives
  whole.
- **The full original stays in the session log** for replay and inspection — nothing is lost,
  it just leaves the agent's working memory.
- Only runs when a pressure trigger qualifies; a short conversation is never touched.
- Character budgets are a heuristic; the **token meter** decides whether pressure actually eased.

Size: ~200 lines. **Test:** a conversation with one huge tool result drops below the threshold
after pruning, the conversation messages are byte-identical, and the original is still readable
from the session log.

## Item 2 — Compaction with summary fallback

When pruning is not enough: condense the **oldest** span into a summary, keep the recent span
intact. Costs one model request; only the summary text is kept.

Two behaviours that matter more than the summarising itself:

- **Overflow recovery.** On a context-overflow error, condense and **retry** rather than failing
  the turn. Today an agent that runs out of room just dies.
- **Manual `/compact`.** On-demand condensation that does not consume a model turn, reporting
  items condensed and tokens saved.

Cannot shrink the system prompt, tool schemas, or session prefix, and cannot split one
indivisible unit such as a single huge tool call. State those limits in the UI.

Size: ~400 lines. **Test:** run a conversation past the limit, then ask about something said
early — the agent still answers correctly. That is the acceptance test for Carson's complaint.

## Item 3 — Repeat-tool reminder

A model gets stuck re-running the same tool with the same arguments — re-reading an unchanged
file, retrying a failing command — burning tokens without progress. Detect the repeat and, at
3, 5, and 8 identical calls, inject a reminder to analyse the last result and either change
approach or finish.

**Advice, never a block.** A legitimately repeated call is not delayed. The decision stays with
the model. Tracked per agent, so one agent's loop never disturbs another's. A new user message
resets the count.

Directly relevant to autonomous runs (`crack_bot`), where a stuck loop currently burns unattended.

Size: ~120 lines. **Test:** three identical calls produce exactly one reminder; a differing
argument resets; two agents tracked independently.

## Item 4 — Tool-call timeout policy

A tool call hangs — a slow fetch, a search that never returns — and the agent waits forever,
stalling the session. Arm a **cooperative** deadline for tools that declare a limit: signal the
tool to stop, then map a settled cancellation to `Error: tool call timed out after <ms>ms`.

Never hard-kills downstream work; a tool that ignores cancellation still holds the caller until
it settles. Zero-config — the limit comes from each tool's own definition.

**This is the one item that can also reach terminal sessions**, since PTY-level watchdogs are
ours.

Size: ~100 lines. **Test:** a tool that never returns yields the timeout error; a tool that
returns just under the limit is unaffected.

## Item 5 — Agent loop: do NOT replace ours

**Recommendation against, deliberately.**

Their `dsh-agent-loop` is the concrete driver — claim prompt, assemble request, stream response,
dispatch tools, append results, repeat — plus `maxParallelToolCalls` to cap parallel tool
execution. It is good. But their own architecture doc says it plainly: *"everything beyond 'call
the model, run the tools, repeat' belongs to plugins."*

The loop is the commodity part. Dobius+ already has one via `agent-runner.ts` and the Claude
Agent SDK, and replacing it would touch every agent path in the app for no behavioural gain.
**Everything we actually lack is items 1–4 — the things that sit *around* the loop.**

The one idea worth lifting from it: **cap parallel tool calls per agent.** A few lines in the
provider seam, not a rewrite.

---

## Where this lands

All of items 1–4 hang off the **`AgentProvider` seam** (`providers/agent-provider.ts`), the same
place Phase 5 puts everything else. Implement once there and all four provider types inherit it
— which is the entire point of having built that seam.

Ordering against the communications work: **items 3 and 4 can ship with Phase 5** (small,
self-contained, no UI). Items 1 and 2 are their own task and should follow Phase 5 but need not
wait for the UI restore.

## Risks

- **Pruning too aggressively destroys the thing it protects.** Budgets must be configurable and
  the token meter, not the character count, decides success.
- **Summarisation costs a model call per compaction.** Debounce it; never compact mid-turn.
- **Do not compact the system prompt or tool schemas** — that path silently breaks tool calling.
- Item 2's acceptance test is subjective by nature. Fix a concrete question about an early
  message and assert on the answer.

## Order

Item 4 → Item 3 (both with Phase 5) → Item 1 → Item 2. Item 5: not doing, by decision.
