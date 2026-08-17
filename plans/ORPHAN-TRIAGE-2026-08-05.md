# The 48 orphan commands — triage
_2026-08-05. Orphan = pending in Dobius's manifest with no `case` in Buzz's e2eBridge.ts._

## Correction to RE-buzz-2026-08-05.md

That report said the 48 had "no reference anywhere" and would need designing from
scratch. **That was wrong.** All 48 have a recoverable Rust implementation in the
commit before the takeover deletion:

    git show 81d7e829e^:desktop/src-tauri/src/<path>     # 623 fns available

Verified: 48/48 orphan names appear as `pub fn` / `pub async fn` in the deleted tree.

**So zero of the 180 pending commands need designing from scratch.** Every one has
either a TypeScript reference (132, in e2eBridge) or a recoverable Rust reference (48).

## Verdicts

### CUT — 13
Not needed for an agent-first communications product.

| Cluster | n | Why |
|---|---|---|
| ~~voice-huddles~~ | ~~17~~ | **MOVED TO DEFER — Carson wants group/conference calls with agents (2026-08-05).** See the Voice section below. |
| channel-templates | 4 | Reusable channel presets. Convenience feature. |
| native cosmetics | 3 | `perform_sidebar_default_haptic`, `set_window_vibrancy`, `title_bar_double_click` — decorative; Electron has its own conventions. |
| human contacts | 2 | `get_contact_list`, `set_contact_list` — human address book. |
| huddle-coupled | 2 | `get_model_status`, `check_pipeline_hotstart` — only call sites are in `features/huddle/`. Follow huddles. |
| `discover_git_bash_prerequisite` | 1 | Windows-only. Dobius+ ships macOS. |
| `publish_note` | 1 | Canvas/notes surface, not in scope. |

### BUILD — 5
Genuinely needed, small, and the Rust spec is recoverable.

| Command | Why |
|---|---|
| `put_agent_session_config` | Managed-agent configuration. Core to the agent product. |
| `put_managed_agent_runtime_lifecycle` | Agent start/stop/restart state. Core. |
| `grant_approval` / `deny_approval` | Agent asks permission before acting. For an agent-first product this is a safety surface, not a nicety. |
| `show_native_notification` | Real value; Electron has a first-class API (`new Notification`). |

### WIRE-SHAPED — 5
`add_relay_member`, `remove_relay_member`, `change_relay_member_role`,
`list_relay_members`, `get_my_relay_membership`.

Disposition `relay`. The relay's Rust **survived** the deletion (`crates/buzz-relay`,
77 files, running on :3300). Probed: no REST route at `/members` — membership is
Nostr-event-based, so these are the *same pattern* as the channel-membership commands
already shipped in Package 2. Known shape, moderate work, no new concepts.

### DEFER — 8
Real, but not before the core loop works.

| Cluster | n | Note |
|---|---|---|
| observer subsystem | 4 | `build_observer_control_event`, `decrypt_observer_event`, `index_observer_channel_id`, `read_archived_observer_events_for_channel` — audit/observability. Encryption-sensitive; deserves its own pass. |
| `read_archived_events` | 1 | Archive retrieval. |
| `upload_media` | 1 | Attachments — already CUT in the inbox spec. |
| `fetch_link_preview_title` | 1 | Link previews in messages. |
| `fetch_workspace_icon` | 1 | Cosmetic. |

## Bottom line

    48 orphans
    -13  CUT      → work that never happens
    -25  DEFER    → later (8 misc + 17 voice huddles, which ARE wanted)
    ────
     10  actually in scope now (5 BUILD + 5 WIRE-shaped)

Combined with the 132 that have a TypeScript reference, the near-term surface is
**132 + 10 = 142**, all with a readable reference implementation. None from scratch.


## Voice huddles — DEFERRED, not cut (2026-08-05)

Carson wants group/conference calls with agents. This is a real product goal, so the
17 huddle commands are **deferred to their own package, not dropped.**

### What Dobius already has (verified 2026-08-05)
`src/main/speech/` is **listening-only**: `model-manager.ts`, `model-catalog.ts`,
`openai-transcription-client.ts`, `openai-api-key-store.ts`, plus IPC + RPC surfaces
(`src/main/ipc/speech.ts`, `src/main/runtime/rpc/methods/speech.ts`). The Parakeet STT
model is already downloaded (see `.dobius/NOTES.md`), and Cmd+E dictation works today.
Mobile additionally ships `expo-two-way-audio`.

**So speech-to-text is solved.** That is the expensive half.

### What is genuinely missing
1. **TTS** — nothing in `src/main/speech/` synthesizes audio. `speak_agent_message` and
   `set_tts_enabled` have no Dobius counterpart. This is the real new build.
2. **Call transport + state** — who is in the huddle, audio between participants,
   join/leave/mute. Buzz's 17 commands cover exactly this, and all 17 Rust impls are
   recoverable from `81d7e829e^`.
3. Audio device enumeration — likely free; Electron exposes
   `navigator.mediaDevices.enumerateDevices()` natively, so `list_audio_output_devices`
   / `get_audio_output_device` / `set_audio_output_device` may not need a native command.

### Sequencing (why not now)
Voice sits **on top of** the text loop: a spoken message still has to reach an agent,
be answered, and come back. That path is only ~half built (54/258 at last count). Build
voice first and you get a call in which nothing useful can be said.

Order: finish the typing loop → then TTS → then huddle transport/state.

### Preserve the option
- Do **not** delete `features/huddle/` from the vendored source; it is the reference.
- Keep `plans/VOICE-CONDUCTOR-PORT.md` in play — a voice plan already exists here.
- Revisit once the core message→agent→reply loop is proven end to end.
