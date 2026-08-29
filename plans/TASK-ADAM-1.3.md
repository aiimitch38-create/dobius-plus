# TASK-ADAM-1.3 — Shell tool: IPC, preload, tool registration

Adds the AGENT's half of the shell surface. TASK-ADAM-1.2 built the human's half
(`runApprovedShell`, `discardShellCommand`, `onShellCommandProposal`, the review
window). Nothing the agent can reach existed until now.

## Algorithm gate

1. **QUESTION.** Does the model need to send an argv array, or a command string?
   A string: `run_dobius` already takes one, `parseCommandArgs`
   (`agent-context.ts:72`) already splits it honouring double-quoted spans, and a
   model emitting a JSON array of tokens gets the splitting wrong more often than
   the tokenizer does. **String, reusing the existing tokenizer — no new one.**
   Questioned and **cut**: an `expects_response: false` "silent" variant. The
   agent must tell the user a command is waiting, so the response is the point.
2. **DELETE.** No tool-diffing here — TASK-ADAM-4.2 owns create/update/delete
   against the live tool list. 1.3 needs only "make sure this one tool exists and
   is attached", so it ships `ensureClientTool` and nothing more.
   No retry/backoff around the API: a failed registration must be visible, and a
   silent retry loop against a billed endpoint is worse than an error.
3. **SIMPLIFY.** The renderer `clientTools` map moves into its own module rather
   than growing a fourth inline entry inside `startSession` — that is what makes
   invariant A testable at all (see below), so the extraction pays for itself
   rather than being tidying.

## What

**`jarvis:proposeShell` in `jarvis-ipc.ts`.** Takes a command string, coerces
with `String(...)` at the boundary — the classifier deliberately does not guard
non-string tokens, carried forward from the TASK-ADAM-1.1 review — splits with
`parseCommandArgs`, and hands the argv to the `ShellCommandStore` built in 1.2.
On `queued`, calls `showShellCommandProposal` and returns `describeForAgent()`.
Read-only output and denial reasons come back the same way. **The return value
is a string in every branch and never contains the pending id.**

**Preload + api-types:** `proposeShell(command: string) => Promise<string>`.

**New `dobius/src/renderer/src/components/jarvis/voice-agent-client-tools.ts`.**
The `clientTools` map lifted out of `use-voice-agent.ts:87-119` verbatim, plus
`propose_shell`. Exported as `createVoiceAgentClientTools()`.

**New `dobius/src/main/jarvis/elevenlabs-tools.ts`.** `ensureClientTool(...)`:
list the agent's tools, create the tool if absent, attach it if unattached.
Idempotent, so a relaunch does not create duplicates. Tool config shape per the
build file: `{tool_config: {type: 'client', name, description, expects_response,
parameters: <JSON-Schema OBJECT, not an array>}}`.

## Invariant A — the test the build file asks for

The build file requires "a test asserting the renderer `clientTools` map contains
no key that can trigger execution". That test was impossible while the map lived
inside `startSession`; extracting it is what makes it writable.

The test stubs `window.api.jarvis` so every method is a spy, invokes **every**
tool in the map with junk parameters, and asserts `runApprovedShell` was never
called. Written over the whole map rather than a hardcoded list of tool names, so
a future tool added carelessly fails the test instead of slipping past it.

This is the fourth layer on top of 1.2's three (agent never learns the id;
delete-before-run; sender check in main).

## Test

- `jarvis:proposeShell` returns a string with no id, for all three verdicts
- a non-string / null command does not throw (boundary coercion)
- `createVoiceAgentClientTools()` exposes `propose_shell` and NOT any approve tool
- **invariant A:** no tool in the map reaches `runApprovedShell`
- `ensureClientTool`: creates when absent; does not re-create when present;
  attaches when unattached; surfaces an API error rather than swallowing it

## WIRING CHECK

`pnpm run build:electron-vite`, then grep `out/` for every name from 1.2 and 1.3:
`jarvis:proposeShell`, `jarvis:runApprovedShell`, `jarvis:discardShellCommand`,
`jarvis:shell-command-proposal`, `propose_shell`.

## Risks

- **The ElevenLabs endpoint shapes are not verifiable here** — no key, and this
  build must not make billed network calls. They are implemented to the shape the
  build file specifies and tested against a fake `fetch`. A live mismatch would
  surface as a registration error at runtime, not silent breakage, because the
  error is returned rather than swallowed. Flagged in `HANDOFF.md` for Carson.
- **Extracting `clientTools` touches a working voice path.** Mitigated by lifting
  the existing four entries verbatim and leaving `startSession`'s call shape
  unchanged; typecheck plus the wiring grep cover the rename.

## Estimate

~110 lines of source, ~140 of test, plus the extraction.
