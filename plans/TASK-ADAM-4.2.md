# TASK-ADAM-4.2 — ElevenLabs tool sync

Local plugins are the source of truth; the agent's registered tools are made to
match. Create what is new, update what changed, delete what disappeared.

## The rule this task is really about

**Ownership is decided by a name prefix, never by a hardcoded list.** Every
plugin-derived tool is `plugin_<name>`, and the sync may only ever delete a tool
whose name starts with `plugin_`.

This is not a style preference. `agent-context.ts:12-18` documents this exact
codebase getting burned by a hardcoded capability list that drifted in both
directions. Here the drift is worse than a stale doc: a "protect these five
names" list that falls behind deletes a working tool off Carson's live
ElevenLabs account, and nothing local can restore it.

So the rule is enforced structurally, twice:

1. `planToolSync` filters remote tools to the `plugin_` prefix **before** it
   computes deletions at all — a non-plugin tool is never a deletion candidate.
2. `syncPluginTools` re-checks the prefix immediately before each delete call,
   so a future edit to the planner cannot reach the API without passing it
   again.

## Algorithm gate

1. **QUESTION.**
   - *Does "update changed" need a diff, or should it just PATCH everything?*
     A blind PATCH per plugin on every launch is simpler code but N writes
     against Carson's account each time the app opens. Worth a diff — **if** the
     diff is free. It is: `/tools` already returns each tool's `tool_config`,
     and `listClientTools` currently throws away everything but the name. So the
     diff costs zero extra API calls. Kept.
   - *Does deletion need to detach the tool from the agent too?* Yes. Deleting
     the tool while its id stays in `tool_ids` leaves the agent pointing at a
     dead id. Handled in the same single PATCH that attaches the new ones.
   - *A canonical/sorted comparison of `parameters`?* **Cut.** The remote config
     was created from this same local shape, so key order matches; and if it
     ever did not, the only cost is one idempotent PATCH. Sorting keys
     recursively is a dozen lines guarding a problem that does not exist.
2. **DELETE.** No retry or backoff. No rollback of a partially applied sync —
   the next launch re-syncs, which is what convergence means. No per-tool agent
   PATCH: one PATCH at the end, not one per tool like `ensureClientTool` does.
3. **SIMPLIFY.** Build on the existing API layer (`listClientTools`,
   `createClientTool`, `getAgentPrompt`, `setAgentToolIds`) rather than a second
   HTTP path; add only the two verbs it lacks. All the judgement goes in ONE
   pure planner so the safety rule is testable without a network.

## What

**`elevenlabs-tools.ts`** gains:
- `description` and `parameters` on `ToolSummary`, parsed from the `tool_config`
  the list endpoint already returns. Optional fields, so `ensureClientTool` is
  untouched.
- `updateClientTool(apiKey, id, config)` — PATCH `/tools/{id}`.
- `deleteClientTool(apiKey, id)` — DELETE `/tools/{id}`. Returns ok on a 404,
  since a tool already gone is the state we wanted.

**New `elevenlabs-tool-sync.ts`:**
- `planToolSync(plugins, remoteTools)` → `{ create, update, remove }`. Pure, no
  network, no clock. This is where the prefix rule lives.
- `syncPluginTools(apiKey, agentId, plugins, fetch)` — executes a plan and
  reconciles the agent's `tool_ids` in one PATCH. Returns a per-tool report and
  never throws.

## Test

Against a fake `fetch`, plus pure-function tests for the planner:

- a new plugin is created
- a plugin whose description changed is updated; one whose config is identical
  is left alone (no wasted write)
- a `plugin_` tool with no matching local plugin is deleted
- **`ask_adam` survives a sync in which no plugins exist at all** — the named
  regression from the build file
- `propose_shell`, `remember`, `forget` and any unknown non-prefixed tool also
  survive that same empty sync
- the executor refuses to delete a non-prefixed tool even when handed one
  directly in a plan, proving the second layer is real
- deleted ids are removed from the agent's `tool_ids` and created ids added, in
  one PATCH
- a failing API call is reported, not thrown

## Risks

- **Deleting a tool off a live account is unrecoverable from here.** Two
  independent prefix checks, and a test that drives the executor with a
  deliberately poisoned plan.
- **This build cannot make real API calls** against Carson's account, so every
  endpoint shape is implemented to the documented shape and tested against a
  fake `fetch`. Flagged for him in `HANDOFF.md`, as with TASK-ADAM-1.3.

## Estimate

~140 lines of source across two files, ~200 of test.
