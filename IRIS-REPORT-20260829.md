# Investigation Report: Dobius+ live voice (⌘T returns nothing)

## Summary

Every individual link in the ElevenLabs live-voice chain is verified working —
signed URL, websocket, agent voice, the `ask_adam` tool, ADAM itself, and the
shipped bundles. The chain still produces nothing for the user because the only
entry point is a global keyboard shortcut whose failure is completely silent,
feeding a UI that renders nothing until *after* a conversation already exists.
The headline finding is not a broken component; it is an **unobservable path
with a single point of entry and no failure feedback**.

## Key Findings

1. **No affordance and no feedback in live mode** — `DictationIndicator.tsx:135`.
   Severity: **high**. Before this session's final change, the orb rendered only
   when `agent.state !== 'idle'`. With ⌘T as the sole trigger, a shortcut that
   never arrives produced: no orb, no error, no log. Indistinguishable from a
   dead feature. Fixed: the orb is now always on screen in live mode and is
   itself the start button.

2. **A refused ⌘T grab is invisible** — `jarvis-service.ts:19`, `:64`.
   Severity: **high**. `globalShortcut.register('CommandOrControl+T')` returns
   false when another app owns the accelerator. `isShortcutActive()` existed but
   was never surfaced, so Settings kept showing Jarvis "on" while the shortcut
   belonged to someone else. Fixed: `jarvis:status` IPC now reports it and
   Settings prints a warning.

3. **⌘T is contended by design** — `jarvis-service.ts:19`. Severity: **medium**.
   ⌘T is "new tab" in most macOS apps, including Dobius+. Claiming it globally
   is a guaranteed conflict, and the loser is silent. A less contended default
   (⌘⇧Space, ⌥Space) would remove a whole class of this failure.

4. **Single-window delivery is a guess** — `jarvis-target-window.ts`.
   Severity: **medium**. When Dobius+ is unfocused, `getFocusedWindow()` is null
   and the press goes to `getAllWindows()[0]` — creation order, not the user's
   window. That window may be a floating panel that never mounts the orb. The
   press is then delivered and dropped with no trace.

5. **The renderer cannot report anything** — whole path. Severity: **high** for
   diagnosis. There is no renderer→main log channel, no CSP-free devtools in
   packaged builds (`DevToolsActivePort` on disk is stale; nothing listens on
   9222), and `jarvis-trace.log` is written by an older build that no longer
   ships. Three debugging cycles were spent inferring what one log line would
   have stated outright.

6. **Verified working, so not suspects** — signed URL `HTTP 200`; websocket
   opens and streams (`pcm_16000` both directions); agent greeted in its own
   voice; `ask_adam` created (`tool_9601m…`) and attached; ADAM answers in 11ms;
   `@elevenlabs/client` is present in the shipped renderer chunk; `ask_adam` and
   `jarvis:agentSignedUrl` are in the shipped bundles; running app inode matches
   the installed asar on every deploy.

## Architecture Map

⌘T (OS global shortcut) → `JarvisService.handlePttPress` → `pickJarvisTargetWindow`
→ one window's `jarvis:ptt-pressed` → `DictationIndicator` (mounted by
`DictationController`, gated at `App.tsx:632`) → `useVoiceAgent.toggle()` →
main mints a signed URL (`elevenlabs-agent.ts`, key never leaves main) →
renderer opens the websocket via `@elevenlabs/client` → agent calls `ask_adam`
→ IPC → `converseWithAdam` → `127.0.0.1:8791` → text returns → agent speaks.

Turn mode and the wake word stand down whenever an agent id is set
(`use-jarvis-turn.ts:270`), so only one owner touches the microphone.

## Risk Areas

- **Global shortcut ownership** — external, changes without notice, silent.
- **Window targeting when unfocused** — order-dependent, untested against real
  multi-window layouts.
- **Agent tool adoption** — the agent decides whether to call `ask_adam` from
  the tool description; the system prompt does not mention it.
- **Observability** — still no renderer log channel; the next failure in this
  path will again be diagnosed by inference.

## Recommendations

1. **Test via the orb, not the shortcut.** The orb is now always visible in live
   mode. Clicking it exercises the entire path with zero dependency on ⌘T. This
   is the single fastest way to split "shortcut broken" from "voice broken".
2. **Add a renderer→main log channel.** One IPC writing to a file under
   `logs/`, called from every catch in the voice path. Cheapest permanent fix
   for the diagnosis problem, and it pays for itself on the next bug.
3. **Move the shortcut off ⌘T** to something uncontended, and show the claim
   result in Settings at all times, not only on failure.
4. **Target the last-focused app window**, tracked explicitly, instead of
   `getAllWindows()[0]`.
5. **Name `ask_adam` in the agent's system prompt** so tool use is instructed
   rather than inferred.
6. **Collapse the naming.** ADAM, "Jarvis", and "the agent" are three names for
   one assistant, and the user has said so. Rename user-facing strings to ADAM.

## Open Questions

1. When ⌘T is pressed, does the orb appear at all? This one observation
   eliminates half the tree and only the user can make it.
2. Does the ⌘T warning appear in Settings → Voice? That answers whether the
   shortcut was ever claimed.
3. Should the shortcut move off ⌘T permanently?

---

# Investigation Report 3: Grok Bot — what to actually ADD

**Method note:** investigation 2 used keyword counts (`grep -c "policy"`) and concluded we
were "covered" on six of eight areas. That method was weak — a file mentioning a word proves
nothing. This pass enumerated their 37 feature extensions and 24 desktop modules, then checked
ours for real implementations. **It found eight genuine additions investigation 2 missed.**

## Summary

Their features are small and well-scoped — 125 to 682 lines each, not architectural monsters.
Eight are worth adding. Two of them (`action-audit`, `auto-review`) are effectively free
because they solve Phase 6 design problems we have not started yet.

## Ranked additions

### 1. Action-audit taxonomy — take the design, today. Severity: high, effort: none

`source/host/extensions/action-audit/action-audit-service.ts` (141 lines). It defines the four
action kinds worth auditing, and **Dobius+ does all four**:

- `mcpToolCall` — server id, tool name, transport, status, duration
- `shellCommand` — command, shell kind, target, **`allowed`, `blockedReason`,
  `classificationReasons`**
- `browserNavigation` — url, page title
- `computerUseSession` — action count, per-action counts, duration, **screenshot count**

Writes `audit.jsonl` per agent locally, plus a durable outbox with rate-limit backoff so
nothing is lost if forwarding fails. Our Phase 6 audit plan currently says "columns: actor,
action, target, decision" — this is that, already thought through, by people who shipped it.
The `computerUseSession` shape is directly relevant to your `feat/computer-use-v2` branch.

### 2. Auto-review's off / shadow / enforce ladder. Severity: high, effort: low

`auto-review-service.ts:6` — `parseLocalAutoReviewMode` accepts `"off" | "shadow" | "enforce"`.
**Shadow mode runs the policy and records the verdict without blocking anything.** That is the
safe way to ship a fail-closed policy: run it shadow for a week, read the audit log for what it
*would* have blocked, then flip to enforce. Our Phase 6 plan goes straight to fail-closed
enforce, which risks locking you out of your own agents on day one. Adopt the three-mode ladder.
(Their classifier calls Cursor's backend — we would use our own model.)

### 3. Memory synthesis. Severity: medium, effort: medium (647 lines)

`memory/memory-synthesis-service.ts`. Not a memory store — a **background LLM pass that turns
conversation evidence into durable memories**, emitting `create` / `update` / `remove` actions
against a snapshot, with a separate verification prompt, 15s debounce, 90s deadline, staleness
detection, and a daily refresh sweep. Memories are typed `profile` or `log`. Our agent memory is
7 files and stores; this learns. This is what makes an agent feel like it knows you.

### 4. Teach recording. Severity: medium, effort: medium (240 lines)

`teach-recording/teach-recording-service.ts`. You perform a task on a private monitor, it
records the session, then fires a `learn-from-demonstration` prompt with the recording queued —
the agent builds a reusable workflow from watching you. Queue entries are HMAC-signed so a
recording cannot be spoofed. **This maps onto your computer-use work**: Dobius+ already has
macOS accessibility and screenshots, which is the capture half. Show it once, it learns it.

### 5. Content search. Severity: medium, effort: medium (682 lines)

`content-search/` — a dedicated search index (`search-index-db`, `-service`, `-worker`,
`-writer`) over agent conversations, built on a background worker so indexing never blocks the
UI. We have **zero** equivalent. With sessions accumulating across projects, "what did that
agent tell me last Tuesday" currently has no answer.

### 6. Local tool permission with scope fencing. Severity: medium, effort: low (125 lines)

`local-tool-permission/` plus `frontend/src/production/local-tool-permission-scope.ts`. Per-tool
approval prompts, and a revision gate that stops a permission granted before logout from being
replayed after logging back in. Directly relevant to your multi-account switching work.

### 7. Cross-user sharing. Severity: low-medium, effort: medium (343 lines)

`cross-user-sharing/` — shared rooms across *people*, with departure obligations, room
tombstones, and remote turns. You work with Sam; our channels are single-user today. Note their
implementation assumes their relay; ours is Nostr, which is arguably better suited to this.

### 8. 1Password integration. Severity: low, effort: low

`source/electron-main/onepassword/`. Secrets pulled from 1Password rather than stored by the
app. We have zero. Relevant given the ElevenLabs key currently blocking your voice work.

## Not worth taking

`vnc` (remote desktop into their VM — we run locally), `wallpaper`, `forever-box`,
`box-lifecycle`, `cloud-agents`, `host-upgrade`, `experiments` (we have 63 files already),
`browser-ua`, `source-map`, `state-backstop`, `codebase-telemetry`.

## Recommendations

1. **Fold items 1 and 2 into the Phase 6 plan now** — they are design decisions, not code, and
   they improve a phase that has not been built yet. Zero cost.
2. **Item 6 alongside Phase 6** — 125 lines, closes a real replay hole.
3. **Items 3, 4, 5 are post-Phase-7 features**, each its own task. Rank: content search first
   (pure win, no risk), then memory synthesis, then teach recording.
4. **Item 8 whenever secrets annoy you next.**
5. **Item 7 only when Sam actually needs to be in a channel with you.**

## Open Questions

- Teach recording needs a private display to record against. Does computer-use v2 give us an
  isolated capture surface, or would it record your live desktop?
- Memory synthesis costs an LLM call per sweep per agent. Acceptable on your plan?

---

# Investigation Report 4: DeepSeek Harness (`dsh`) — how it improves Dobius+

**Target:** `github.com/deepseek-ai/deepseek-harness` — MIT, TypeScript, 202,647 stars,
51 packages, last pushed 2026-08-27. Everything-is-a-plugin architecture on Cordis.

## Summary

Two findings, and the first one is a defect in our own code. **Dobius+ advertises ACP support
it does not have** — the harness catalog tells you to "add an ACP-speaking CLI" while the
provider underneath writes raw text to stdin. Fixing that is the highest-leverage change
available to the harness, because DeepSeek Harness ships a complete ACP server and would then
plug in with no further integration work. Second: their E2B package family is a working,
MIT-licensed implementation of "every agent gets its own cloud computer."

## Key Findings

1. **Our harness claims ACP and does not implement it. Severity: high.**
   - `HarnessCatalogSection.tsx:166` — UI text: *"No harnesses yet. Add an ACP-speaking CLI
     below."*
   - `HarnessCatalogSection.tsx:205` — the args placeholder literally suggests `acp`.
   - `custom-harness-store.ts:8` — comment describes the record as an "external ACP-speaking
     CLI command."
   - But `custom-harness-provider.ts:151` sends work as **`child.stdin.write(prompt + "\n")`**
     and reads raw `stdout` at line 97. That is plain pipes.
   - `grep` for `agent-client-protocol` across `src/` and `package.json`: **no dependency, no
     implementation.**

   ACP (agentclientprotocol.com) is JSON-RPC over stdio with sessions, resume, cancellation,
   tool-call lifecycle, and model selection. A real ACP agent registered in Dobius+ today would
   wait for a handshake that never comes. The catalog promises an ecosystem it cannot talk to.

2. **Implementing ACP properly makes `dsh` plug in for free. Severity: high, effort: medium.**
   `packages/acp` ships `dsh-acp`: *"lets trusted programs drive persistent DeepSeek Harness
   agents over the standard Agent Client Protocol — create or resume sessions, list resumable
   sessions, attach MCP servers, select a model and reasoning effort, prompt or cancel work,
   receive semantic execution updates."* Started with `dsh --profile acp`.

   Sessions persist across process restarts, so list/resume/close survive a Dobius+ relaunch —
   which fits the daemon model this app already uses. And ACP is a standard: the same client
   gets us Zed's agents and any other ACP-speaking tool, not just this one.

3. **E2B family = agents with their own cloud computers. Severity: medium (it is what you
   asked for), effort: medium.** Three packages, mounted together:
   - `dsh-e2b` — one shared remote Linux sandbox; configure API key, remote working directory,
     and lifetime. Created on start, deleted when the lifetime expires or the app shuts down.
   - `dsh-fs-e2b` — the agent's file reads/writes/edits happen in the sandbox. *"The host
     machine's files are never touched."*
   - `dsh-subprocess-e2b` — Bash and interactive terminals run remotely. *"Secrets and host
     environment variables never leak into the sandbox: only environment entries the agent
     explicitly requests are passed along."*

   Unlike Grok Bot's Docker box (investigation 3, finding 3 — no `--network none`, no
   `--cap-drop`), this is a real isolation boundary: a different machine. Cost is latency, and
   nothing is enabled by default.

4. **The plugin architecture is not worth adopting. Severity: info.** Cordis makes every part —
   model adapter, tool registry, session log, even the agent loop — a replaceable plugin, with
   registrations that unwind on unload. Genuinely elegant. But adopting it means restructuring
   Dobius+ around a foreign framework. Our `AgentProvider` seam already gives us swappable
   providers, which is the 20% of that idea that matters here.

5. **Developer preview — pin the version.** The README states in bold: *"THERE WILL BE
   COMPATIBILITY-BREAKING CHANGES."* Anything we integrate should pin an exact version, and ACP
   (a standard, versioned outside their repo) is a safer coupling than their packages.

## Recommendations

1. **Implement a real ACP client in the custom-harness provider.** This is one focused task and
   it converts the harness from "CLIs we hacked stdin for" into "any agent in the ACP
   ecosystem." Do it as part of Phase 5, or immediately after.
2. **Until then, fix the copy.** `HarnessCatalogSection.tsx:166` and `custom-harness-store.ts:8`
   should say what the code does — a CLI that reads prompts on stdin — not ACP. Shipping UI
   that names a protocol we do not speak is how you get a bug report you cannot reproduce.
3. **Register `dsh --profile acp` as the first real harness** once ACP lands. It is the proof
   the seam works against something we did not write.
4. **Adopt the E2B family as the answer to "agents with their own computers"** rather than
   Grok Bot's container. Replaces `TASK-COMMS-P8-ADDITIONS.md` item B-cloud entirely.
5. **Do not adopt Cordis.**

## Open Questions

- E2B is a paid cloud sandbox service. Is a per-sandbox running cost acceptable, or should
  agent computers stay local?
- Does ACP's session-resume model line up with our daemon's session restore, or do they fight?
