# Investigation Report: Mark LI (51) — feature audit

Target: `aiimitch38-create/Mark-LI` (fork of `FatihMakes/Mark-LI`), Python, 18,062 lines.
Question: what does it actually ship, and what is worth taking into Dobius+?

## Summary

Mark LI is a single-process Python desktop assistant built on the Gemini Live
API, with a PyQt6 HUD, 22 built-in tools, a drop-in plugin system, a JSON
long-term memory, and a phone-accessible web dashboard. Its genuinely novel
parts are not the voice loop — Dobius+ now matches that — but four things:
**a plugin contract that adds a capability without touching the engine**, **a
proactive engine that decides when to speak unprompted**, **a memory file the
model writes to itself**, and **session resumption with sliding-window
compression so one conversation survives for hours**.

The headline finding: roughly two-thirds of its tool surface (`open_app`,
`browser_control`, `computer_control`, `file_controller`, `system_status`)
duplicates what the `dobius` CLI already exposes to Adam. Copying those would be
waste. The remaining third is where the value is.

## Key Findings

1. **Plugin system — drop a file, get a tool** (`core/plugin_loader.py:1-188`,
   `plugins/_template.py`). A plugin is one file exporting a `PLUGIN` dict
   (name, description, JSON-schema parameters) and a `run(parameters, player,
   session_memory) -> str`. Discovery happens once at startup; enable/disable is
   re-read from config on every `get_tool_declarations()` call, so toggling does
   not require a restart. Name collisions and invalid records are caught and
   surfaced to the UI rather than crashing. Severity: **high value**.

2. **Proactive engine** (`actions/proactive.py:1-124`). Two gates decide when to
   speak unprompted: 900s of user silence and 1200s since the last proactive
   message. It then builds a context snapshot — time-of-day bucket, stored
   memory, monitored topics, last 6 conversation turns — and **rotates through
   three focus areas** so repeated check-ins do not sound identical. The prompt
   ends with "if nothing genuinely useful comes to mind, stay silent."
   Severity: **high value**.

3. **Model-writable memory** (`main.py:772-786`, `memory/memory_manager.py`).
   `save_memory` is a first-class tool with fixed categories — identity,
   preferences, projects, relationships, wishes, notes — persisted to
   `long_term.json`, capped at 380 chars per value and 2200 total, and injected
   into the system prompt on every connect. The model decides what to remember.
   Note the tool returns `{"result": "ok", "silent": True}` so saving does not
   produce speech. Severity: **high value**.

4. **Session durability** (`main.py:743-748`). `SessionResumptionConfig()` plus
   `ContextWindowCompressionConfig(sliding_window=...)` means the conversation
   never dies from a full context window. There is also a documented fallback
   (`main.py:1556-1566`): if the enhanced audio features are rejected, it
   reconnects with the plain config rather than failing. Severity: **medium**.

5. **Affective dialog + proactive audio** (`main.py:757-762`). Two Gemini Live
   flags: `enable_affective_dialog` (adapts tone to the user's emotion) and
   `ProactivityConfig(proactive_audio=True)` (stays silent when speech is not
   addressed to it). Both are platform features, not code — no ElevenLabs
   equivalent found. Severity: **info**.

6. **Identity injection overrides the prompt file** (`main.py:719-730`). Name
   and form of address are read from config and prepended as an `[IDENTITY]`
   block that explicitly "overrides any hardcoded name in prompt.txt". Directly
   relevant: Adam's identity and "boss"/"Carson" problems were the same bug
   class, solved here by construction. Severity: **medium**.

7. **Background topic monitor** (`actions/background_monitor.py:1-159`). Watches
   user-named topics, checks news once per day per topic, hashes headlines to
   avoid repeats. Notable for its **blocklist**: crypto terms in eight languages
   are refused regardless of what the user asks. Severity: **low**.

8. **Self-building dev agent** (`actions/dev_agent.py:1-601`). Planner and
   writer models generate projects into `~/Desktop/JarvisProjects` with
   `MAX_FIX_ATTEMPTS = 5` self-repair iterations. Dobius+ does this far better
   via real agents in real worktrees. Severity: **skip**.

9. **Phone dashboard** (`dashboard/server.py:1-884`). Local HTTP on :8000 with
   AES-256-CBC at the application layer and a QR code to pair a phone.
   Severity: **low** — Dobius+ has its own relay and mobile build.

10. **Duplicated surface — do not port.** `open_app` (272 lines),
    `browser_control` (1059), `computer_control` (513), `file_controller` (554),
    `computer_settings` (705), `system_status` (200). All covered by `dobius`
    CLI groups Adam already has. Severity: **info**.

## Architecture Map

```
ui.py (PyQt6 HUD, 3480 lines)
   │
main.py (1625) ── JarvisLive
   ├── _build_config()  → time + identity + memory + prompt.txt
   │                      + TOOL_DECLARATIONS + plugin declarations
   │                      + session resumption + sliding-window compression
   ├── live.connect(gemini-2.5-flash-native-audio) ── one bidirectional socket
   ├── _send_realtime()   mic → model
   ├── _execute_tool(fc)  → actions/*.py, else → PluginRegistry.run()
   └── ProactiveEngine    silence gate → unprompted speech
         │
memory/long_term.json ← save_memory tool (model-written)
plugins/*.py          ← discovered at startup, toggled at runtime
```

Everything is one process. The model is the orchestrator; there are no
sub-agents, no worktrees, no task queue.

## Risk Areas

- **Single process, single conversation.** No isolation between tasks; a crash
  takes the whole assistant down. Dobius+'s worktree-per-agent model is stronger.
- **Memory is a flat JSON file** capped at 2200 chars, injected wholesale into
  every prompt. Simple and durable, but it does not scale to 20 repos — that is
  what RAG is for.
- **`_BLOCKED` is a substring match** (`background_monitor.py:26`), so "coin"
  blocks "coincidence". Crude, and worth knowing before copying the pattern.
- **Gemini-specific throughout.** `types.LiveConnectConfig`, affective dialog,
  proactivity are Google APIs. The *ideas* port; the code does not.

## Recommendations

Ordered by value to Dobius+, given Adam already has live voice, the CLI, context,
self-edit, and orchestration.

1. **Plugin contract for Adam's tools** (from finding 1). A folder where one
   file — name, description, JSON-schema params, a run function — becomes a new
   voice tool with no engine change. Today every new capability costs an
   ElevenLabs tool registration plus a renderer change plus a rebuild. This is
   the single biggest multiplier in the repo.
2. **Proactive engine** (finding 2). Adam speaks unprompted when something
   finishes or breaks. Dobius+ already has the signal the original lacks: real
   terminal logs, orchestration task state, and build outcomes. Port the *gates*
   (silence threshold, cooldown, rotation, "stay silent if nothing useful") and
   feed them real events rather than time-of-day guesses.
3. **`remember` tool with fixed categories** (finding 3). Adam decides what is
   worth keeping; it lands in the knowledge base. The category list — identity,
   preferences, projects, relationships, wishes, notes — is a good starting
   schema, and the `silent: True` response pattern is worth copying so saving
   does not interrupt speech.
4. **Identity injection by construction** (finding 6). Build the `[IDENTITY]`
   block from config at connect time instead of hand-editing the prompt.
5. **Skip** findings 8, 9, 10 entirely, and treat 5 and 7 as informational.

## Open Questions

1. Does ElevenLabs expose anything equivalent to `proactive_audio` — knowing
   when speech is not addressed to the agent? Not found in the docs read so far.
   Without it, an always-listening Adam will answer the room.
2. Should the plugin contract be TypeScript files in the repo (rebuild needed)
   or a user folder loaded at runtime (no rebuild, but unsigned code executing
   in main)? The security tradeoff is real and is the user's call.
3. Proactive speech needs a hard mute. What is the off switch, and should it be
   time-boxed (working hours only)?
