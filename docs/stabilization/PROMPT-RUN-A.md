# Run A — Architecture map + bug matrix (planning only, no fixes)

## Role and stakes

You are the principal engineer planning the stabilization of **Dobius+ V2**. It's an Electron desktop app that runs real shell terminals and paid AI coding agents (Claude via @anthropic-ai/claude-agent-sdk, Codex CLI) for one solo developer, Carson.

A deep audit found **123 numbered bugs**: security holes, silent data loss, runaway agents, and broken installs. Your documents become the blueprint that later agents follow build-by-build. A wrong architecture claim or a missing bug sends every later fix in the wrong direction. **Trace real code; don't paraphrase the audit.**

This is **Run A of two**. Run A produces the architecture map and the bug matrix only. Run B (a later run) will produce phases, execution order, branches, safety gates and BUILD-001, using your two documents as input.

## Where things are (absolute paths)

- **Your working directory (the only place you may write):**
  `/Users/bayou/Projects (Code)/Dobius/dobius-plus/.claude/worktrees/stabilize-iris`
  It's a sparse git worktree on branch `stabilize/iris-20260923` containing only `docs/stabilization/`.
- **Full source to READ (never write here):**
  `/Users/bayou/Projects (Code)/Dobius/dobius-plus`
  - The active app is `dobius/`: `dobius/src/main`, `dobius/src/preload`, `dobius/src/renderer`, `dobius/src/relay`, `dobius/src/cli`, `dobius/src/shared`.
  - Repo-root `src/`, `electron/`, `mobile/` are the **legacy V1 app**. Ignore them, except where a bug is about V1 still writing shared data (bug 52).
- **Related service:** `/Users/bayou/dobius/projects/ADAM` (the control plane Dobius forwards events to; read `HANDOFF.md`, `service/src/adapters/dobius.ts`, `service/src/projects/handshake.ts`).
- **Live app data (read non-secret JSON only if needed):** `~/Library/Application Support/dobius-plus/`

## Read first, in this order

1. `docs/stabilization/BUG-LIST-123.md` (in your working dir): the **canonical 1–123 numbering** plus the "by design", "open decision" and X-items sections. Numbers are canonical; never renumber.
2. `docs/stabilization/IRIS-REPORT-20260923-DEEP.md` and `docs/stabilization/IRIS-REPORT-20260923.md`: the evidence (file:line) behind each bug. The BUG-LIST "Report ID" column maps to these.
3. `/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius/AGENTS.md`: repo rules (no `max-lines` disables, no vague file names like utils/helpers, SSH and cross-platform matter).
4. `/Users/bayou/Obsidian Vault/AI Research/Dobius Agentic Gap Analysis 2026-09-23.md` and `/Users/bayou/Obsidian Vault/AI Research/Vertex And Dobius Architecture.md`: context for why "global execution control" should be designed with ADAM in mind (X12).

## Task

### Deliverable 1: `docs/stabilization/ARCHITECTURE-MAP.md`

Map how Dobius actually works today, from the code. Cover each area with the key files (path:line) and how data flows:

- **Desktop app:** main process startup (`dobius/src/main/index.ts`), preload (`dobius/src/preload/index.ts`), renderer, IPC registration (`dobius/src/main/ipc/`), and the `runtime:call` passthrough.
- **Data layer:** every persisted file under userData and `~/.dobius`. For each: owner module, atomic or not, what happens on a corrupt file, backups, and who else writes it. The deep report's "D" section has a starting inventory; verify it rather than copying it.
- **Agent runtime:** `dobius/src/main/agents/`: the start lifecycle for the Claude and Codex paths, tools and `mcp__dobius__*`, hard rails, budgets and caps, slots (`reservedRuns`, in-flight sets), cancellation, run history, sessions and reset, the decision queue.
- **Orchestration:** `dobius/src/main/runtime/orchestration/`: the state machine, dispatch, heartbeats, convergence.
- **Automation:** `dobius/src/main/automations/`, Asana (`dobius/src/main/asana/`, `agents/asana-auto-mode-service.ts`), Kanban auto-dispatch (`renderer/src/components/kanban/board-dispatch.ts`), and **every place the pause switch is or isn't checked**.
- **Voice:** Jarvis (`main/jarvis/`, `renderer/.../jarvis/`), Voice Conductor (`main/voice-conductor/`), dictation and STT (`main/speech/`, `renderer/.../dictation/`).
- **Remote control:** runtime RPC (`main/runtime/runtime-rpc.ts`, `main/runtime/rpc/`), the phone/WebSocket and E2EE layer, device registry and pairing, the localhost dispatch server (`main/dobius-cli/dispatch-server.ts`, port 8421), the agent hook server.
- **Messaging:** the iMessage bridge (`main/imessage-bridge/`) and the conductor's iMessage asks.
- **ADAM link:** `main/agents/agent-run-event-journal.ts`, `main/jarvis/adam-client.ts`.
- **Build/release:** `build-and-install.sh`, `scripts/install-dobius-*.sh`, `dobius/package.json` scripts, `dobius/config/electron-builder.config.cjs`, the updater (`main/updater*.ts`, `main/dobius-disconnect.ts`), versions and tags.
- **Settings/config:** where each duplicated source of truth lives (ADAM URL/token, lane GIDs, data dirs, the STT endpoint, the iMessage handle, CLI paths).

Required sections:
- **Trust boundaries**: every path by which text from outside (phone, iMessage, Asana, renderer, hook payloads, voice) can reach a shell, the filesystem, or a paid agent run.
- **Shared root causes**: which bugs share one underlying weakness. At minimum evaluate these, and add any others you find:
  - global execution control / pause
  - authorization and capability profiles
  - secure path canonicalization
  - agent run policy (budget, turns, tools, concurrency)
  - safe persistence
  - run lifecycle / state machine
  - event delivery to ADAM
  - remote transport security
  - config registry
  - safe release pipeline

Use Mermaid diagrams where they clarify flow. Mark anything you could not verify as `UNVERIFIED`.

### Deliverable 2: `docs/stabilization/BUG-MATRIX.md`

One row for **every** bug 1–123, in numeric order, with these columns:

| ID | Category | Severity | Verified | Root Cause Area | Component (path:line) | Depends on (bug IDs) | Proposed Fix (1–2 sentences) | Test Strategy | Cluster |

- **Severity:**
  - P0 = remote code/control, credential exposure, irreversible data loss
  - P1 = major reliability failure
  - P2 = significant defect
  - P3 = cleanup
- **Verified:** copy `Confirmed` / `Static` from BUG-LIST, and add your own column result:
  - `Re-traced` (you read the cited code and it holds)
  - `Refuted` (the code disproves it; give evidence)
  - `Could not locate`

  **Do not claim anything was runtime-verified**; nothing is being executed.
- **Cluster:** the shared-root-cause name from the architecture map.

After the table:
- **X-items:** a section giving each of X1–X12 a one-line disposition (which cluster it belongs to).
- **By design:** confirm C2/C3 are excluded.
- **Coverage line:** `BUG COVERAGE: <n> / 123`. List any missing IDs.

## Rules and guardrails

- **Planning only.** Write only the two files above, inside the working directory. Do not edit any source file anywhere.
- **Never run:** builds, installs, `build-and-install.sh`, `scripts/install-*`, tests that launch the app, `pnpm install`, `git commit`/`push`/`checkout`/`stash`/`reset`, anything that starts or kills processes, network calls.
- **Allowed:** `rg`, `grep`, `sed -n`, `cat`, `ls`, `wc`, `stat`, `git log`/`show`/`blame` (read-only). `rg` may only be called directly on the command line, not from inside scripts.
- **Never read secret file contents:** `*token*`, `.env*`, `auth.json`, `service-token`, `*.enc`, `dobius-devices.json`, `dobius-e2ee-keypair.json`, `dobius-environments.json`, `~/.claude/.credentials*`. You may `stat` them. Never print an API key.
- **By design, do not treat as bugs:**
  - **C2**: Jarvis may apply its own proposed edits.
  - **C3**: Jarvis may send terminal input by voice.
- **iMessage → terminal stays as a feature.** Plan a guard, not removal.
- **Collaboration constraint:** Dobius sits on an inherited engine that Carson doesn't own. In the matrix, add a note `Upstream` to any bug whose fix lives mainly in inherited engine code (e.g. runtime RPC, persistence core, daemon), so it can be offered back to that engine's owner.
- **Write each file to disk as soon as it is complete.** If you run low on room, finish and save BUG-MATRIX.md first (it matters most), then the architecture map.

## Return format (your final message is data, not chat)

1. The two file paths written.
2. `BUG COVERAGE: n / 123`.
3. A list of every bug you marked `Refuted` or `Could not locate`, with one line of evidence each.
4. The shared-root-cause clusters you settled on, each with its bug IDs.
5. Anything important that is **not** in the audit (new bugs you noticed), each as one line with path:line. Don't add them to the 123.

## If blocked

If a cited file or line doesn't exist, say so in that row (`Could not locate`) and move on. Don't guess.
