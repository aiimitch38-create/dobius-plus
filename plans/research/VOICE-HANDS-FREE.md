# Hands-free voice: what is still missing from the voice branch (plan 8.15)

Research only. No app code changed. Written 2026-11-21 by the research worker for task `task_a463f70bfd87`.

Read first: `plans/WORKSTATION-BUILD-PLAN.md` (Phase 8, row 8.15) and `plans/research/IRIS-PLAN-AUDIT-20261121.md`.
That audit file is not in this checkout, and the plan has no "Audit 2026-11-21" box at its top. Both are flagged in the open questions.

## Plain-English terms used below

- **Branch** (a named copy of the code's history you can work on).
- **STT** (speech to text: turning spoken words into text).
- **TTS** (text to speech: turning text into spoken words).
- **VAD** (voice activity detection: noticing when someone starts and stops talking).
- **KWS** (keyword spotting: listening for one phrase, like "Hey Adam", without a full transcript).
- **Barge-in** (the user talks over ADAM and ADAM stops speaking).
- **RPC** (a remote procedure call: one part of the app asking another part to do a job by name, such as `voice.intent`).

## What I checked

Every fact below was read from git or the source in this session.

- Voice branch: `fork/feat/adam-voice-control`, 33 commits not on the workstation line (`aiimitch38-create/workstation-build`). Found on the `fork` remote only, read with `git show` and `git diff`. Nothing checked out.
- Branch commits touch 148 files. 85 of them are absent at the same path on the workstation line. 63 exist there, some in older or newer form. (Verified with `git cat-file` per path.) This is more than the "44 files" figure in the plan, so the plan number is out of date.
- Branch commit subjects run from `acff0364` (ElevenLabs voice agent) through the ADAM build (TASK-ADAM-1.1 to 4.3) and the voice build (TASK-VOICE-1.1 to 5.1). The workstation line has none of the TASK-VOICE work.
- A second branch, `feat/jarvis-voice-loop`, is 9 commits ahead of the workstation line. Verified.

## Findings

### 1. The workstation line already has a working voice path (verified)

- Speaking: native Hermes voice first, ElevenLabs as fallback. `dobius/src/main/jarvis/jarvis-service.ts:153` (native) and `:161` (ElevenLabs).
- Native voice uses an Edge voice by default: `dobius/src/main/jarvis/hermes-native-tts.ts:10`.
- Wake phrase: a text matcher that only fires when the phrase starts a final speech-to-text transcript. `dobius/src/main/jarvis/wake-word-matcher.ts:5` (regex) and `:25` (factory). Wired at `jarvis-service.ts:14` and `:63`.
- Hermes voice turns with an approval callback for commands: `dobius/src/main/jarvis/adam-hermes-voice.ts:19` (the `approve` option) and `:222-228` (the approval path).
- ElevenLabs client tools (`ask_adam` and friends) are defined inline in the renderer: `dobius/src/renderer/src/components/jarvis/use-voice-agent.ts:113`.
- Mobile method classes: `voice.intent` is classed BENIGN and `voice.reply` READ at `dobius/src/main/runtime/mobile-rpc-method-classes.ts:36-37`. Listed in `dobius/src/main/runtime/runtime-rpc.ts:146-147`.

### 2. Missing on the workstation line (verified present on branch, absent on line)

Grouped by what they do. "Absent" means the same path does not exist on the workstation line.

| Group | Branch files (lines, from `wc -l`) | Absent on line |
|---|---|---|
| Always-on offline wake word | `speech/wake-kws.ts` (117) | yes |
| Speech endpointing (knowing when you stopped talking) | `speech/silence-endpointer.ts` (74), `speech/vad-endpoint.ts` (40) | yes |
| Barge-in (talk over ADAM) | `jarvis/barge-in.ts` (72) | yes (`speech/barge-in.ts` is empty on branch) |
| Streaming brain seam | `jarvis/voice-brain.ts` (196), `jarvis/sentence-stream.ts` (74) | yes |
| Offline voice engine (sherpa-onnx models) | `speech/local-tts.ts` (254), `speech/local-tts-speaker.ts` (127), `speech/sherpa-module-path.ts` (26), `speech/tts-bakeoff.ts` (124), `renderer/.../settings/VoiceEngineSection.tsx` (133) | yes |
| Shell commands by voice + approval card | `jarvis/shell-tool.ts` (249), `jarvis/shell-command-store.ts` (140), `renderer/.../jarvis/ShellCommandReview.tsx` (108) | yes |
| ElevenLabs tool registry + plugins | `jarvis/elevenlabs-tools.ts` (315), `jarvis/elevenlabs-tool-sync.ts` (213), `jarvis/plugin-loader.ts` (204), `jarvis/adam-memory.ts` (239), `renderer/.../jarvis/voice-agent-client-tools.ts` | yes |
| Proactive watcher | `jarvis/proactive-watcher.ts` (271) | yes |
| Orb and push-to-talk UI (from `feat/jarvis-voice-loop`) | `jarvis/jarvis-trace.ts`, `renderer/.../jarvis/JarvisVoiceController.tsx`, `jarvis-audio-level.ts`, `jarvis-mic-yield.ts`, `jarvis-toggle-registry.ts`, `renderer/.../store/slices/jarvis.ts` | yes (6 files, matches the brief) |

Notes:
- `wake-kws.ts` needs a model called `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`, downloaded from GitHub on first use (verified: `wake-kws.ts:10-11`). `local-tts.ts` downloads Kokoro and Supertonic models the same way (verified: `local-tts.ts:37-45`). Both need a download step and a fallback when the download fails.
- The workstation line already depends on `sherpa-onnx` 1.12.37 in `dobius/package.json:132`. So the native library is already installed. The models are not.

### 3. Conflicts and decisions (verified unless marked inferred)

- **The voice-conductor RPC file on the branch is older. Do not port it.** The branch's `dobius/src/main/voice-conductor/service.ts` was last changed 2026-07-15 (`caee2df0`). The workstation line's copy was changed 2026-10-23 (`038f7f28`). Porting the branch version would undo the newer work. The diff removes the workstation line's persistent work-registry, its settings-driven Asana lane, the board group-address routing, and the iMessage handle lookup.
- **`voice.intent` and `voice.reply` have no caller.** Searched the workstation line and both voice branches, excluding tests: no UI, mobile or script calls either method. Only the definitions (`src/main/runtime/rpc/methods/voice-conductor.ts:22,30`) and the lists (`runtime-rpc.ts`, `mobile-rpc-method-classes.ts`) mention them. So today these are a door into the conductor that nothing uses.
- **Hermes already handles approval.** The branch's `shell-tool` runs shell commands itself and asks for approval in a card. On the workstation line, Hermes runs the shell under Adam's profile, and approval comes back through `adam-hermes-voice.ts:222-228`. Two approval systems would be one too many. (Inferred: Hermes runs its own shell tools. I did not read the Hermes runtime to confirm this.)
- **Two wake-word systems would compete.** The workstation line's text matcher and the branch's keyword spotter both own the phrase "Hey Adam". Pick one. The text matcher needs speech-to-text running all the time. The keyword spotter is cheaper and offline, but it needs its own model download.
- **Three speakers would then exist.** The workstation line already has Hermes native voice and ElevenLabs. The branch adds a local sherpa engine. Pick one default and keep the rest optional.
- **Security note (inferred).** `voice.intent` is classed BENIGN in `mobile-rpc-method-classes.ts:36`. It posts a transcript into the conductor. A BENIGN class may skip the checks a write needs. Confirm before any port.

## Recommendation, per missing piece

| Piece | Verdict | Why |
|---|---|---|
| Voice-conductor RPC service (branch `service.ts`) | DROP | Older than the workstation line. Porting regresses it. |
| `voice.intent` / `voice.reply` | DECIDE (lean: keep only if the phone sends voice) | No caller anywhere. Pick the one door; route voice turns through Hermes. |
| `wake-kws.ts` (offline "Hey Adam") | DECIDE, then REWRITE | Only worth it for always-on listening. Would sit beside the text matcher, not replace it without a choice. |
| `silence-endpointer.ts`, `vad-endpoint.ts` | PORT AS-IS (after the wake decision) | Self-contained (no imports). Needed by hands-free. |
| `jarvis/barge-in.ts` | REWRITE | It imports the branch's STT service. Hook it into the workstation line's `jarvis-service.ts` instead. |
| `voice-brain.ts`, `sentence-stream.ts` | REWRITE or DROP | Streaming brain seam. Hermes already runs the brain. Check whether Hermes streams before porting. |
| Local sherpa TTS (`local-tts*`, `sherpa-module-path`, `tts-bakeoff`, `VoiceEngineSection`) | DECIDE | A third speaker. Drop the bake-off harness. Keep only if Carson wants offline speech. |
| `shell-tool`, `shell-command-store`, `ShellCommandReview` | DROP for v1 (inferred) | Duplicates Hermes approval. Port the review card only if voice shell commands stay on the ElevenLabs path. |
| `elevenlabs-tools`, `elevenlabs-tool-sync`, `plugin-loader`, `adam-memory` | DROP for v1 (inferred) | Overlap Hermes memory and tools. Revisit after 8.19 (Command Center). |
| `proactive-watcher.ts` | DEFER | Depends on the event log (plan 8.1) and terminal history. Port after 8.1. |
| Orb and push-to-talk UI (`feat/jarvis-voice-loop`) | PORT the trace and controller if the orb returns; the Alt+Space rebind (`fde723c8`) is newer | The trace file is a small debugging aid. |

## Task list (for the build, after decisions)

Sizes: S = under half a day, M = one to two days, L = longer.

1. (S) Decide the wake-word design (text matcher only, or add keyword spotter). Decision, not code.
2. (S) Remove or lock `voice.intent` / `voice.reply` (`dobius/src/main/runtime/rpc/methods/voice-conductor.ts`, `dobius/src/main/runtime/runtime-rpc.ts`, `dobius/src/main/runtime/mobile-rpc-method-classes.ts`). Depends on decision 4 below.
3. (S) Port `dobius/src/main/speech/silence-endpointer.ts` and `dobius/src/main/speech/vad-endpoint.ts` as-is, with their tests.
4. (M) Rewrite barge-in into `dobius/src/main/jarvis/jarvis-service.ts` using the ported `jarvis/barge-in.ts` logic. Needs the workstation line's STT path.
5. (M) If kept: port `speech/wake-kws.ts` with its model download, and hook it into `jarvis-service.ts:186` beside the text matcher.
6. (M) If kept: port `local-tts.ts` and `local-tts-speaker.ts` with `sherpa-module-path.ts`, then `VoiceEngineSection.tsx` into the settings pane.
7. (S) Port the orb controller and trace (`jarvis-trace.ts`, `JarvisVoiceController.tsx`, `jarvis-audio-level.ts`, `jarvis-mic-yield.ts`) if the orb returns.
8. (L) Proactive watcher (`dobius/src/main/jarvis/proactive-watcher.ts`). After the event log (plan 8.1).
9. Tests: the branch's `*.test.ts` files for each ported module, plus the known baseline failures (164 in `src/main/ipc/pty.test.ts`; 16 in renderer terminal-pane tests).

## Open questions for Carson

1. Should "Hey Adam" be always-on (offline keyword spotter, needs a model download) or only when the app is open (text matcher, already on the workstation line)?
2. Do you want an offline voice engine (sherpa Kokoro/Supertonic), or is Hermes voice plus ElevenLabs enough?
3. Should ADAM run shell commands by voice? If yes, keep the approval card (`ShellCommandReview`). If Hermes handles it, drop the card.
4. Does the phone need to send voice turns? If not, drop `voice.intent` and `voice.reply`.
5. Do you want the ADAM plugin system and model-writable memory back (`plugin-loader.ts`, `adam-memory.ts`), or does Hermes memory replace them?
6. Should the floating orb come back (from `feat/jarvis-voice-loop`)?
7. The plan says the audit lives at `plans/research/IRIS-PLAN-AUDIT-20261121.md` and has an "Audit 2026-11-21" box. Neither is in this checkout. Which audit should win?

## Confidence

- Verified against git and source: file lists, line counts, the conductor version dates, the zero-caller check, the native and ElevenLabs speak order, the wake matcher location.
- Inferred, not directly checked: that Hermes runs its own shell commands; that a BENIGN class skips write checks; that the Hermes runtime does not already stream. Each needs a read of `adam-hermes-runtime.ts` or the Hermes side before a build decision.
