# TASK-ADAM-1.3 — REVIEW

Re-read of `jarvis-ipc.ts`, `elevenlabs-tools.ts` + test, `voice-agent-client-tools.ts`
+ test, `use-voice-agent.ts`, `shell-command-store.test.ts`, `preload/index.ts`,
`preload/api-types.ts`.

## Fixed in this pass

### 1. The startup PATCH could have wiped Carson's agent system prompt

`ensureClientTool` attached the new tool by PATCHing:

```json
{"conversation_config": {"agent": {"prompt": {"tool_ids": ["t1", "t9"]}}}}
```

That is correct **only if** the ElevenLabs API deep-merges a nested object. If it
replaces `prompt` instead, this silently destroys the agent's system prompt,
`first_message` and LLM choice — on Carson's live billed account, on every app
launch, unrecoverable from here and invisible until the next call sounds wrong.

I cannot verify which semantics the API has without making billed calls against
his account, and "probably merges" is not a good enough basis for an unattended
write that runs at startup. Fixed by reading the agent's existing `prompt` block
and sending it back with `tool_ids` replaced, so **both** semantics are safe. One
extra field on a request that was already being made.

New test: `never sends a PATCH that would drop the agent system prompt` asserts
`prompt` and `first_message` survive the round trip.

Two related properties kept and tested: the tool list is **appended** to, never
replaced (a fresh list would detach `ask_adam`), and `ensureClientTool` is
idempotent by tool NAME so relaunching cannot accumulate duplicates.

### 2. The invariant-A test was written to be falsifiable, and checked

The build file asks for "a test asserting the renderer `clientTools` map contains
no key that can trigger execution". A test like that can easily be vacuous, so I
verified it by temporarily adding the exact tool it exists to catch:

```
FAIL … INVARIANT A … has no tool, anywhere in the map, that runs an approved command
AssertionError: approve_shell reached runApprovedShell: expected "vi.fn()" to not
be called at all, but actually been called 1 times
```

It names the offending tool. It iterates the whole map rather than a hardcoded
list, so a careless future addition fails rather than slipping past.

## The clientTools extraction

Moving the map out of `startSession` is what made the above testable — inline, it
could not be imported without a live conversation, so invariant A rested on
nobody ever adding the wrong entry. The four existing tools were lifted verbatim.

Verified by the WIRING CHECK rather than by reading: every hand-written tool name
is still in the built bundle — `ask_adam`, `run_dobius`, `get_context`,
`propose_code_change`, `apply_code_change`, plus the new `propose_shell` and all
four shell channels. Nothing was dropped in the move.

## Reviewed and deliberately left alone

- **`propose_shell` takes a command STRING, not an argv array.** Reuses
  `parseCommandArgs` (`agent-context.ts:72`), as `run_dobius` already does. A
  model emitting a JSON token array gets the splitting wrong more often than the
  tokenizer does, and a second tokenizer is a second thing to get wrong. Tested
  with a quoted path containing a space.
- **The review window's description is the fixed string "Adam asked to run
  this."** Letting the model supply it means the model writes the text that
  persuades the human to click Run. A fixed label is the safer default; the argv
  itself is the thing to read.
- **Startup registration re-runs if `registerJarvisIpcHandlers` is called twice.**
  Idempotent, so the cost is a redundant API round trip, not a duplicate tool.
- **The endpoint shapes are unverified against the live API.** Tested against a
  fake `fetch` to the shape the build file specifies. Errors are returned rather
  than swallowed and logged at startup, so a mismatch surfaces as a visible
  warning rather than a tool that silently never appears. Flagged in `HANDOFF.md`.

## Verification

- Scoped gate: **318 passing** (295 + 23), one failing file
  (`attach-main-window-services.test.ts`, pre-existing and expected).
- Both tsgo configs exit 0. `npx oxlint` clean on all nine touched files.
- `pnpm run build:electron-vite` exit 0; WIRING CHECK passes for all ten names.
