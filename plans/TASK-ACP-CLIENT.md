# TASK-ACP — make the harness actually speak ACP

Written 2026-08-29. Evidence: `IRIS-REPORT-20260829.md` investigation 4.

## The defect

Dobius+ tells users to register "an ACP-speaking CLI" and cannot speak ACP.

- `HarnessCatalogSection.tsx:166` — *"No harnesses yet. Add an ACP-speaking CLI below."*
- `HarnessCatalogSection.tsx:205` — args placeholder suggests `acp`
- `custom-harness-store.ts:8` — comment: "external ACP-speaking CLI command"
- `custom-harness-provider.ts:151` — actually does `child.stdin.write(prompt + "\n")`
- No `agent-client-protocol` dependency anywhere; no implementation in `src/`

A real ACP agent registered today waits for a JSON-RPC handshake that never arrives.

## Two steps, in this order

### Step 1 — tell the truth (do immediately, minutes)

Until the client exists, change the copy to describe what the code does: a CLI that reads a
prompt on stdin and writes replies on stdout. Shipping UI that names a protocol we do not speak
produces bug reports nobody can reproduce.

Files: `HarnessCatalogSection.tsx:166,205`, `custom-harness-store.ts:8`.

### Step 2 — implement the ACP client

ACP (agentclientprotocol.com) is JSON-RPC over stdio: create/resume sessions, list resumable
sessions, attach MCP servers, select model and reasoning effort, prompt, cancel, receive tool
lifecycle and context-usage updates.

Add a fourth provider — `acp-provider.ts` — behind the existing `AgentProvider` seam
(`providers/agent-provider.ts`). Map the seam's five methods onto ACP:

| Seam method | ACP |
| --- | --- |
| `launch` | create session, send first prompt |
| `send` | prompt on the existing session |
| `subscribe` | stream session updates → `AgentRunEvent` |
| `cancel` | cancel |
| `status` | session state + context usage |

Keep `custom-harness` (raw stdin) as its own provider — some CLIs will never speak ACP. The
harness record gains a protocol field: `stdin` or `acp`.

## Why this is the highest-leverage harness change

ACP is a standard, not one vendor's API. One client gets us **every** agent that speaks it —
including DeepSeek Harness, which ships a complete ACP server (`dsh --profile acp`, MIT,
sessions persist across process restarts, which suits our daemon model). Zed's agents too.

Without it, every new agent is a bespoke integration. With it, adding an agent is a settings row.

## Test

- Unit: seam methods map to the right JSON-RPC calls; a malformed response fails cleanly.
- Integration: `npx @deepseek-ai/dsh --profile acp` registered as a harness, prompted from a
  channel, replies under its own identity. **This is the acceptance test** — it proves the seam
  works against something we did not write.

## Risks

- **Version drift.** DeepSeek Harness is developer-preview with warned breaking changes. Couple
  to ACP the standard, pin any dsh version we test against, never import their packages.
- Session resume may overlap awkwardly with our daemon's own session restore — check before
  building resume, and prefer ACP owning agent sessions while the daemon owns terminal sessions.

## Order

Step 1 now (it is a copy fix). Step 2 with or immediately after Phase 5 — it is the difference
between a harness catalogue that works and one that only looks like it does.
