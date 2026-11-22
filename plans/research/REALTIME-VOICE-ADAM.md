# Live voice for ADAM: OpenAI GPT-Live-1.1 research and design

Research only. No code changed, nothing installed, no paid API calls, no secret files read.
Written 2026-11-22.

## Short answer

"ChatGPT's live voice 1.1" is a real thing in the API. The model ID is `gpt-live-1.1`. OpenAI's community announcement is dated 2026-11-20, and it says the same model has run ChatGPT voice since October 15.

It is a good fit for an all-day ADAM. It bills by the minute, it has a cheap "standby" rate while nobody is talking, and it is built to hand real work to a backend "brain" while it keeps the conversation going.

Dobius+ has no OpenAI live voice code today. It does have most of the parts around it: a secure OpenAI key store, a live voice hook for ElevenLabs to copy, ADAM's real brain (Hermes) behind one function, and a guarded way to run `dobius` commands by voice.

Estimated cost for an 8-hour day: about **$13** in voice minutes with a realistic mix, **$24** worst case, plus the separate cost of the brain model. Details and labels in section 1.7.

## Plain-English terms

- **API** (a way for one program to ask another program to do something). **API key** (the password for that).
- **Model** (the AI itself; `gpt-live-1.1` is one specific model).
- **WebRTC** (the browser technology used for live audio calls, the same thing video-call apps use).
- **WebSocket** (a connection that stays open so two programs can send messages back and forth).
- **SDP offer/answer** (the short handshake text two sides swap to start a WebRTC call).
- **Full duplex** (both sides can talk and listen at the same time, like a phone call).
- **Barge-in** (you talk over the assistant and it stops and listens).
- **Delegation** (the voice model hands a job to a second, smarter model or to our app, then speaks the result).
- **Tool / function calling** (the model asks our app to run a named action, such as "create a task").
- **Token** (the chunks of text or audio an AI reads and writes; many models bill per token).
- **Main process / renderer** (an Electron app has a private back half, "main", and a visible window half, "renderer". Secrets stay in main.)
- **IPC** (the private channel the window uses to ask main to do something).
- **RPC** (one part of the app asking another to run a job by name, such as `orchestration.taskCreate`).
- **CLI** (a command typed in a terminal; `dobius orchestration dispatch` is one).

---

## 1. What OpenAI offers today

OpenAI now has **two** separate voice APIs. Both are current.

| | Live API | Realtime API |
|---|---|---|
| Model | `gpt-live-1.1` (also `gpt-live-1`) | `gpt-realtime-2.1`, `gpt-realtime-2.1-mini` |
| Endpoint | `v1/live/sessions` | `v1/realtime` |
| Billing | Per minute of session | Per token (audio and text) |
| Who picks tools | A backend brain, through delegation | The voice model itself |
| Turn taking | Model decides when to speak, full duplex | Voice detection or manual push-to-talk |

Source for the table: verified against the model pages and the migration guide listed below. The two APIs are not compatible. The `gpt-live-1.1` model page lists Realtime (`v1/realtime`) as not supported, and the `gpt-realtime-2.1` page lists Live as not supported.

### 1.1 Model names, and what "1.1" means

- **`gpt-live-1.1`** is the exact match for "live voice 1.1". Verified on the model page: "Full-duplex voice model for multilingual conversations", "can listen while it speaks". It improves on `gpt-live-1` with more accurate transcription and steadier accent and voice.
- **Release date:** the community announcement is dated 2026-11-20 (verified). A search summary said it was added on 2026-11-19. The model page itself shows no date, so the exact day is unverified.
- **Same model as ChatGPT voice:** the announcement says it has powered voice in ChatGPT Plus and Pro since October 15 (verified on the community post, not on a docs page).
- **Realtime family:** `gpt-realtime-2.1` and `gpt-realtime-2.1-mini` are the current ones on the models list (verified). The pricing page still lists `gpt-realtime-2`, `gpt-realtime-1.5`, `gpt-realtime` and `gpt-realtime-mini`. `gpt-realtime-2` was announced 2026-05-07 with "GPT-5-class reasoning".
- There is no `gpt-realtime-1.1`. The only "1.1" in OpenAI voice is `gpt-live-1.1`.

### 1.2 How a desktop app connects

**Live API (`gpt-live-1.1`), verified on the WebRTC guide and the create-session reference:**

1. The window asks for the microphone, builds a WebRTC connection, and opens a data channel named `oai-events`.
2. The window makes an SDP offer and hands it to the trusted back half of the app.
3. The back half sends `POST /v1/live/sessions` with the session settings and the offer, using the real API key.
4. OpenAI returns an SDP answer. The window applies it and waits for `session.started`.

- The docs show **no ephemeral (short-lived) client key for the Live API**. They say "Keep the API key on your backend." (Verified by absence on four Live pages. I could not prove none exists anywhere.)
- For Electron this is fine. The main process is the "backend". The key never has to reach the window. This is the same shape Dobius+ already uses for ElevenLabs.
- WebRTC is the recommended transport. A WebSocket (`wss://api.openai.com/v1/live/sessions`) also works and could run entirely in the main process, but then our app has to move raw audio itself. Standby mode is documented for WebRTC sessions only.
- There is also a "sideband" WebSocket so a server can watch or steer a call whose audio runs over WebRTC.

**Realtime API (`gpt-realtime-2.1`), verified on the Realtime guide:**

- WebRTC in the browser, WebSocket on a server.
- It does have ephemeral keys: `POST /v1/realtime/client_secrets`. WebRTC calls are set up through `/v1/realtime/calls`.

### 1.3 Tool and function calling in a live session

**Live API.** The voice model does not call tools itself. It delegates. Three modes, set when the session is created and not changeable afterwards (verified on the create-session reference and the delegation guide):

- **`responses` delegation.** OpenAI runs a backend model we choose. We give it `tools` (our own functions, plus hosted ones such as web search or MCP). When it wants one of our functions, the call arrives on the data channel inside a `response.event`. We read `call_id`, `name` and `arguments` from the nested `response.output_item.done`, run the function, send back `response.item.create` with a `function_call_output`, then send `response.create` to continue. Every pending call needs an answer. `parallel_tool_calls` is supported.
- **`client` delegation** (the default). Our own app is the brain. The session sends `session.delegation.created` with an id. That event does **not** contain what the user said, so our app must follow the transcript events (`session.input_transcript.delta`, `session.output_transcript.delta`) itself. We send results back with `session.commentary.append` (say this), `session.thinking.append` (know this quietly) or `session.instructions.append` (new standing instruction). Each is capped at 500 tokens.
- **`decisions` delegation.** A classifier mode. Not needed here.

The docs put safety on us: "Your application enforces permissions and required confirmations before running custom tools." Interrupting the conversation does **not** cancel backend work; the app must cancel it.

**Realtime API.** Classic function calling. Tools are set with `session.update`. The call shows up in `response.done` as a `function_call` item. We answer with `conversation.item.create` (`function_call_output`) then `response.create`. `gpt-realtime-2.1` supports function calling, configurable reasoning effort and prompt caching (verified).

### 1.4 Session length and reconnection

- **Live API maximum length: 2 hours, partly verified.** The create-session reference says connected calls are limited to 2 hours and "these limits are not configurable in the request." That sentence sits near the phone-call (SIP) settings, so whether it also binds WebRTC sessions is unverified. One secondary site also reports 2 hours. `session.started` carries an `expires_at` value, and sessions can end with reason `expired` ("The session reached its duration limit").
- **Plan for at least 4 reconnects in an 8-hour day.**
- **Reconnection, Live API (verified):** a session can be forked from a stored recording (`POST /v1/live/sessions/{id}/fork`, needs `store: true`, recordings kept 30 days). Without that, start a new session and seed it with saved text history through the `input` field (up to 128 messages, 8,192 tokens).
- **Context, Live API (verified):** 128,000-token window. Above 90% it swaps in "a replacement voice engine within the same session", and older history "may be summarized or omitted". The docs say to keep key facts in the app.
- **Realtime API maximum length (verified):** "The maximum duration of a Realtime session is 60 minutes." Reconnection is not covered on the page I read (unverified).

### 1.5 Interruption and barge-in

- **Live API (verified):** "GPT-Live is full duplex: the caller and assistant can speak at the same time." It decides when to speak. There is no manual "commit audio" step and no event that marks the end of each spoken reply.
- **Mute (verified):** `session.input_audio.mute` and `session.input_audio.unmute`. Muting "leaves the session running", so a muted session still bills.
- **Push-to-talk:** not mentioned in the Live docs. It would be built as mute plus unmute. Unverified how well the model behaves that way.
- **Realtime API (verified):** on WebRTC the server "will automatically truncate unplayed audio when there's a user interruption". On WebSocket the app must stop playback and send `conversation.item.truncate`. True push-to-talk exists: set `turn_detection` to `null`.

### 1.6 Standby mode (the reason an all-day session is affordable)

Verified on the Live session guide, the create-session reference and the announcement:

- Set `wake_policy: { type: "speech" }` on a WebRTC session. The model waits for speech before it starts working.
- Set `idle_timeout_s` to a whole number from 5 to 60. After that much silence the model pauses while the call stays open. It resumes when someone speaks.
- `vad_threshold` (0 to 1, default 0.5) sets how loud speech must be to wake it.
- The app hears `session.paused` and `session.resumed`. These are what a local cost meter should count.
- Without `idle_timeout_s`, the session "stays active after the first wake until the session ends", which means full price all day.

### 1.7 Pricing and the 8-hour estimate

**Verified on the pricing page and the `gpt-live-1.1` model page (two sources agree):**

- `gpt-live-1.1`: **$0.05 per minute active**, **$0.02 per minute standby**, billed per second.
- Audio in and audio out are **not** priced separately on the Live API. The session minute is the unit.
- "Backend model and tool usage billed separately." The brain costs extra.
- Creating a WebRTC session bills 15 seconds up front, credited back once the session runs.

**Verified on the pricing page for the Realtime API (per 1 million tokens):**

- `gpt-realtime-2.1`: audio in $32, cached in $0.40, audio out $64. Text in $4, text out $24.
- `gpt-realtime-2.1-mini`: audio in $10, cached in $0.30, audio out $20.
- Token rates (verified on the costs guide): user audio is 1 token per 100 ms, about 600 per minute. Assistant audio is 1 token per 50 ms, about 1,200 per minute.
- My arithmetic from those two facts: about **$0.019 per minute of you talking** and about **$0.077 per minute of the model talking** on `gpt-realtime-2.1`. On top of that, "The entire conversation is sent to the model for each Response", so long sessions cost more per turn.

**ESTIMATE: 8-hour day on `gpt-live-1.1` (480 minutes). Voice minutes only.**

| Scenario | Math | Voice cost |
|---|---|---|
| Worst case, active all day (standby not set up) | 480 x $0.05 | **$24.00** |
| Realistic, 2 hours active and 6 hours standby | 120 x $0.05 + 360 x $0.02 | **$13.20** |
| Light, 1 hour active and 7 hours standby | 60 x $0.05 + 420 x $0.02 | **$11.40** |
| Floor, standby all day | 480 x $0.02 | **$9.60** |
| Connect only when talking, 1 hour total | 60 x $0.05 | **$3.00** |

These are estimates. They assume the published rates, and they leave out the brain. The brain cost is unknown until the delegation model is chosen. If ADAM's own Hermes profile is the brain, OpenAI charges nothing extra for it, and Hermes's own model usage applies instead.

**ESTIMATE, rougher: the same day on `gpt-realtime-2.1`.** With 1 hour of you talking and 1 hour of the model talking, fresh audio is about $1.15 + $4.61 = $5.76. Re-reading the growing conversation each turn adds more, and I could not compute that reliably. Treat it as "$6 minimum, likely two to four times that". Unverified beyond the two rates.

### 1.8 Things I could not confirm

- Whether the 2-hour limit applies to WebRTC sessions and not just phone calls.
- The concurrent-session limit for Carson's account. The docs say `gpt-live-1.1` and `gpt-live-1` have separate limits and point to the account's own limits page. A community reply notes the 1.1 page does not publish them.
- Which backend models are allowed for `responses` delegation on Carson's account. The docs examples use names such as `gpt-5.6-terra`. Unverified.
- The exact usage fields in `session.closed`. The reference page is very long and I read only the first quarter.
- A community bug report from late October 2026 says `gpt-live-1` sometimes generated audio that never reached the client. Unverified, may be fixed.

### Sources

- Model page, GPT-Live-1.1: https://developers.openai.com/api/docs/models/gpt-live-1.1
- Announcement: https://community.openai.com/t/gpt-live-1-1-has-arrived-in-the-api/1418537
- Pricing: https://developers.openai.com/api/docs/pricing
- Models list: https://developers.openai.com/api/docs/models
- Getting started with GPT-Live: https://developers.openai.com/api/docs/guides/live
- Managing GPT-Live sessions (standby, mute, context, forking): https://developers.openai.com/api/docs/guides/live-conversations
- Delegation and tools in GPT-Live: https://developers.openai.com/api/docs/guides/live-delegation
- WebRTC guide, Live: https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- Create session reference: https://developers.openai.com/api/reference/resources/live/methods/create
- Live primary WebSocket reference: https://developers.openai.com/api/reference/resources/live/primary-websocket
- Migrate to GPT-Live: https://developers.openai.com/api/docs/guides/live-migration
- Realtime guide: https://developers.openai.com/api/docs/guides/realtime
- Realtime conversations (60-minute limit, interruption, push-to-talk): https://developers.openai.com/api/docs/guides/realtime-conversations
- Realtime costs: https://developers.openai.com/api/docs/guides/realtime-costs
- Model page, GPT-Realtime-2.1: https://developers.openai.com/api/docs/models/gpt-realtime-2.1
- GPT-Realtime-2 announcement (2026-05-07): https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/
- Secondary, not relied on for facts: https://www.marktechpost.com/2026/11/21/openai-gpt-live-1-1-api-standby-mode/

---

## 2. What Dobius+ already has

All paths are under `/Users/bayou/Projects (Code)/dobius-plus/WORKSTATION-BUILD/dobius/src`. Read on branch `aiimitch38-create/workstation-build` at commit `19bd5d1c`. Everything here is verified by reading the file unless marked.

### 2.1 No OpenAI live voice code exists

- A search for `gpt-realtime`, `realtime-preview`, `/v1/realtime` and `api.openai.com` found one OpenAI network call in the whole app: `main/speech/openai-transcription-client.ts:9`, which posts recorded audio to `https://api.openai.com/v1/audio/transcriptions`. That is one-shot speech to text, not a live session.
- Every other "realtime" match is an unrelated test file.

### 2.2 ADAM's voice today (turn-based)

- `main/jarvis/jarvis-service.ts` is the main-process voice loop. It owns the system-wide push-to-talk shortcut (`CommandOrControl+T`, line 16), sends each finished sentence to ADAM (`ask`, line 106), and speaks the answer.
- Speaking order (`speak`, line 144): ADAM's own Hermes voice first, then ElevenLabs, then the built-in system voice.
- `main/jarvis/adam-hermes-voice.ts` is the real ADAM brain for voice. One class, `AdamHermesVoice`. `ask(text)` opens or resumes a Hermes session under the `adam` profile, submits the text, and waits for `message.complete`. It has a 3-minute timeout per turn (line 55) and allows only one turn at a time (line 44).
- It already has an approval hook. When Hermes wants to run a command, `adam-hermes-voice.ts:220-239` calls `approve`, and `main/jarvis/jarvis-ipc.ts:65-77` shows a native "Adam voice, allow command?" box with Cancel as the default.
- `main/jarvis/adam-hermes-runtime.ts` finds the Hermes install and the `~/.hermes/profiles/adam` profile. It forces `HERMES_VOICE=0` and `HERMES_VOICE_TTS=0` (lines 138-139), so Hermes does not do its own audio here.
- `main/jarvis/adam-hermes-session.ts` saves the voice session id so the conversation resumes after a restart.
- `main/jarvis/wake-word-matcher.ts` is a text match for "Hey Adam" on finished transcripts. It is off unless `voice.jarvisWakeWord` is on.

### 2.3 The ElevenLabs path (the closest thing to live voice today)

- `renderer/src/components/jarvis/use-voice-agent.ts` holds a live ElevenLabs conversation in the window. This is the template for an OpenAI version.
- The key stays in main. `main/jarvis/elevenlabs-agent.ts` mints a short-lived signed URL, exposed as IPC `jarvis:agentSignedUrl` (`jarvis-ipc.ts:277`).
- It already defines voice tools (`use-voice-agent.ts:113-173`): `ask_adam` (hands the request to real ADAM through `jarvis:askAdamText`), `get_context`, `run_dobius`, `propose_code_change`, `apply_code_change`, `undo_code_change`, `power_off`.
- It hangs up after 60 seconds of silence (`IDLE_HANGUP_MS`, line 14) because ElevenLabs bills connected minutes.
- The setting `preferNativeAdamVoice` (`shared/speech-types.ts`) defaults to on, so the orb talks to real Hermes ADAM, turn by turn, and not to the ElevenLabs agent. Today the choice is "real ADAM but slow turns" or "fast live voice but a stand-in". GPT-Live with delegation is the first option that could give both.

### 2.4 The guarded `dobius` command runner

- `main/jarvis/agent-context.ts:117` `runDobiusCommand(command)` runs `/usr/local/bin/dobius` with a 12-second timeout and a 4,000-character output cap.
- It allows only command groups that the CLI's own `--help` lists, and it refuses these verbs outright (lines 37-47): `rm`, `remove`, `delete`, `reset`, `stop`, `close`, `run-stop`, `setup-delete`, `set-base-ref`. The comment explains why: "Voice is a lossy channel, destructive actions stay a keyboard decision."
- `buildAgentContext` and `buildOpeningLine` in the same file produce a snapshot of what Carson is working on.

### 2.5 Orchestration ADAM can call

- CLI (verified in `cli/specs/orchestration.ts`, `cli/specs/core.ts`, `cli/help.ts:96-110`):
  - `dobius orchestration task-create --spec <text> [--task-title <text>] [--deps <json_array>] [--parent <task_id>]`
  - `dobius orchestration task-list [--status <status>] [--ready]`
  - `dobius orchestration task-update --id <task_id> --status <status>`
  - `dobius orchestration dispatch --task <task_id> --to <handle> [--inject] [--dry-run]`
  - `dobius orchestration check`, `inbox`, `reply`, `send`, `ask`, `gate-create`, `gate-resolve`, `gate-list`
  - `dobius terminal list`, `terminal read [--terminal <handle>] [--cursor <n>] [--limit <n>]`, `terminal send [--terminal <handle>] [--text <text>] [--enter] [--require-agent-status sendable]`
  - `dobius worktree ps` ("Show a compact orchestration summary across worktrees"), `dobius board consoles`, `dobius board spawn-console`, `dobius tasks list`
- Runtime RPC (verified in `main/runtime/rpc/methods/orchestration.ts`): `orchestration.send`, `.check`, `.reply`, `.inbox`, `.taskCreate`, `.taskList`, `.taskUpdate`, `.dispatch`, `.dispatchShow`, `.ask`, `.reset`.
- In-process access: `main/dobius-cli/dispatch-server.ts:24` defines `DobiusCliDispatcher` with `listTerminals`, `sendTerminal`, `readTerminal`, `createTerminal`. The Voice Conductor already uses it (`main/voice-conductor/service.ts`).

### 2.6 The Voice Conductor (ported from Sam)

- `main/voice-conductor/` (13 files) runs a background Claude session that takes text commands and dispatches work. Its prompt (`conductor-system-prompt.ts`) already spells out the approval rules: confirm before `git push`, PR comments, Asana writes, messages to other people, deletes.
- `main/runtime/rpc/methods/voice-conductor.ts` exposes `voice.intent` and `voice.reply`. The earlier research file found nothing calls them.
- It is gated by the `voice.conductorEnabled` setting.

### 2.7 Secure key storage (where the OpenAI key lives)

- **`main/speech/openai-api-key-store.ts`.** The key is encrypted with Electron `safeStorage` (the macOS Keychain-backed encryptor) and written to `~/.dobius/openai-speech-token.enc` with owner-only permissions. It refuses to write plaintext. If encryption is unavailable it keeps the key in memory for that session only.
- The window never sees the key. IPC is `speech:getOpenAiApiKeyStatus`, `speech:saveOpenAiApiKey`, `speech:clearOpenAiApiKey` (`main/ipc/speech.ts:24-33`). The Settings screen already has an entry dialog: `renderer/src/components/settings/OpenAiTranscriptionKeyDialog.tsx`.
- One difference to note: the ElevenLabs store (`main/jarvis/elevenlabs-key-store.ts`) keeps separate files for the dev build and the installed app. The OpenAI store uses one file for both.
- Microphone permission for the main window is already handled (`main/window/attach-main-window-services.ts:208-226`).

### 2.8 What the earlier research file says

`plans/research/VOICE-HANDS-FREE.md` (dated 2026-11-21) covers the older voice branch `fork/feat/adam-voice-control`. Relevant points, as that file states them:

- That branch has barge-in, silence detection, an offline wake word, an orb controller and a streaming "voice brain" that the workstation line lacks.
- Its recommendation was to port silence detection, rewrite barge-in, and decide on the wake word.
- **GPT-Live changes that picture.** Barge-in, knowing when you stopped talking, and streaming speech all come built into the model. If this design goes ahead, tasks 3, 4 and most of 5 in that file are no longer needed for the live path. The offline wake word is still the only way to start listening without an open paid session.

---

## 3. What Sam built

Read-only from the team remote (`origin` = `statusdigitalmarketing/dobius-plus`) in `/Users/bayou/Projects (Code)/Dobius/dobius-plus`. Nothing checked out.

**There is no realtime or live voice API in Sam's app.** `git grep -n -i "realtime" origin/main -- electron src` returns only three lines in a test file about `setTimeout`. Verified.

What he has instead is a **record, transcribe, type, reply** chain:

1. **Voice Conductor** (commit `d1150d73`, 2026-06-02). `electron/voice-conductor.js` keeps a long-running Claude Opus session in a hidden terminal in `~/dobius-voice-conductor`. Text commands arrive as typed input. It dispatches with small commands (`dobius-send`, `dobius-tabs`, `dobius-reply`). `electron/voice-bridge.js` is a local-only web server on `127.0.0.1:8421` with a token, exposing routes such as `/tabSend`, `/spawn`, `/ask`, `/trackWork`, `/asana/fetch`.
2. **Phone hold-to-talk** (commit `54be04e6`, 2026-07-31). `mobile/VoiceButton.jsx` records on the phone. `electron/voice-transcribe.js` turns it into text on the Mac with whisper.cpp. "No cloud STT; audio never leaves the Mac."
3. **Faster local transcription** (commit `aac72d2b`, 2026-10-18). A whisper server that stays loaded, about 50 ms for a 4-second clip by his measurement.
4. **Kokoro voice for the Speak button** (commit `b2638c72`, 2026-10-18). Local text to speech through a Python script, falling back to the macOS `say` command.
5. **Voice into the orchestrator tab** (commit `be0cbd46`, 2026-11-10). If a team orchestrator tab is pinned, the transcript is typed into it. Otherwise it goes to the Voice Conductor.
6. **Confirm before send** (commit `fc927672`, 2026-11-11). The phone shows what it heard with Send, Keep talking and Discard. Each send has an id so nothing is delivered twice. Documented in `docs/mobile-voice-api.md`.
7. A lesson worth keeping (commit `e2a1ea1e`, 2026-09-02): the always-on Conductor session grew until it crashed the whole Mac about every 2 hours. He made it opt-in and recycles it every 90 minutes.

**How it differs from what Carson wants:**

| | Sam's voice | Carson's ask |
|---|---|---|
| Shape | One command at a time: speak, wait, read or hear a reply | A continuous conversation all day |
| Speech to text | Local whisper.cpp, free, private | Cloud voice model, paid per minute |
| The voice | Local Kokoro or `say`, only on a Speak button | The model speaks naturally and can be interrupted |
| Brain | A Claude Opus terminal session | ADAM (Hermes profile) or an OpenAI backend model |
| Where | Phone first, Mac does the work | Desktop app, hands-free |
| Safety | Confirm on screen before each send | Needs its own confirm and spend rules |

Sam's is "kind of like it" because it already routes spoken commands into orchestration with strong safety. It is "not like it" because it is not live, has no barge-in and has no speaking persona. Carson's own app already contains a port of the Conductor half (section 2.6).

---

## 4. Recommended design

### 4.1 The shape

```
Mic and speaker (window)
   |  WebRTC audio + "oai-events" data channel
   v
OpenAI gpt-live-1.1  <---- session created by MAIN with the real key
   |  delegates work
   v
ADAM tools, run in MAIN  --->  dobius orchestration / terminal / board
                         --->  real ADAM (Hermes) for deep work
```

- The **window** owns the microphone and the WebRTC call. It never holds the API key.
- **Main** holds the key, creates the session, runs every tool, counts the minutes, and enforces the rules.
- This mirrors the ElevenLabs path, so the pattern is already proven in this codebase.

### 4.2 How the session becomes ADAM

**System prompt** (the `instructions` field, up to 16,384 tokens, fixed at session start). Contents:

- Who he is: ADAM, Carson's orchestrator inside Dobius+. Short spoken answers. No code read aloud.
- How to work: hand anything that needs facts or action to the backend. Never claim something happened until a tool says so (the docs give the same advice).
- Carson's rules, taken from the existing Conductor prompt: confirm before push, deploy, Asana writes, messages to others, deletes. One approval covers one action.
- Voice is lossy: read back names, task titles and targets before acting on them.

**Starting context** (the `input` field, up to 128 messages and 8,192 tokens): the output of the existing `buildAgentContext` (open terminals, what is running) plus a short summary of the previous session.

**Tools** (functions given to the backend model in `delegation.responses.tools`), each mapped to something that already exists:

| Tool | Maps to | Risk class |
|---|---|---|
| `board_summary` | `dobius worktree ps`, `dobius orchestration task-list`, `dobius board consoles` | Read |
| `list_terminals` | `dobius terminal list` | Read |
| `read_terminal` | `dobius terminal read --terminal <handle> --limit <n>` | Read |
| `check_inbox` | `dobius orchestration check` / `inbox` | Read |
| `create_task` | `dobius orchestration task-create --spec ... --task-title ...` | Act |
| `dispatch_task` | `dobius orchestration dispatch --task <id> --to <handle>` | Act, read back first |
| `send_to_terminal` | `dobius terminal send --terminal <handle> --text ... --enter --require-agent-status sendable` | Act, read back first |
| `spawn_worker` | `dobius board spawn-console` | Confirm on screen (it starts paid agent work) |
| `ask_adam` | `AdamHermesVoice.ask()` (real ADAM, with his memory and his own approval box) | Act |
| `power_off` | Close the session and dock the orb | Safe |

Use **typed tools with fixed arguments**, not a free-form "run any dobius command" tool. A misheard word then cannot become an unexpected command. Keep the existing denied-verb list as a second wall.

**Which delegation mode.** Recommended: **`responses` delegation** for version 1, with `ask_adam` as the bridge to real ADAM.

- Why: function calls arrive fully formed (`name`, `arguments`). With `client` delegation the event carries no task text and the app must rebuild the request from transcript fragments, which the docs warn "can contain mistakes".
- Trade-off: the fast orchestration decisions are made by an OpenAI backend model, not by Hermes ADAM. Real ADAM is one tool call away for anything deep.
- Later option: switch to `client` delegation so Hermes ADAM is the only brain. That is a new session mode, not a small tweak, so treat it as a version 2 decision.

### 4.3 Keeping it safe all day

1. **Three risk classes, enforced in main, not in the prompt.**
   - Read: runs straight away.
   - Act (create task, dispatch, send to a terminal): ADAM reads back the target and text, then main runs it. Every action is written to a local log.
   - Confirm (anything outward or destructive, and anything that starts paid agent runs): a native on-screen box with Cancel as the default, the same one `jarvis-ipc.ts:65-77` already uses. A spoken "yes" alone never approves these, because the microphone can pick up other voices and the terminal text ADAM reads could contain planted instructions.
2. **Destructive verbs stay keyboard-only.** Keep `DENIED_VERBS` from `agent-context.ts` as is.
3. **Terminal output is untrusted.** The prompt says so, and the tool layer never lets text from `read_terminal` trigger a Confirm-class action without the box.
4. **Spend cap.** Main counts active and standby seconds from `session.started`, `session.paused`, `session.resumed` and `session.closed`, multiplies by $0.05 and $0.02, and stores a per-day total. At 80% ADAM says so. At 100% main closes the session and the orb shows why. Recommended default: **$15 per day**. The meter is an estimate until checked against the OpenAI usage page, so the first week should compare the two (two-source rule).
5. **Mute by default.** The session starts muted. The existing push-to-talk shortcut toggles the microphone. Hands-free is an explicit switch, and it turns on standby (`wake_policy: speech`, `idle_timeout_s: 30`).
6. **Never sit at full price.** Always set `idle_timeout_s`. If the session has been in standby for 20 minutes, close it. Reconnecting takes a moment and costs nothing while closed.
7. **Recycle on purpose.** Reconnect a little before the 2-hour mark at a quiet moment, seeded with a short text summary. This also avoids the "long-lived session grows until it crashes" problem Sam hit.
8. **Cancel real work on interrupt.** Because interrupting speech does not stop backend work, a "stop" from Carson must call `AdamHermesVoice.cancel()` and drop pending tool calls.
9. **Privacy note for Carson.** Unlike Sam's local whisper, microphone audio goes to OpenAI while the session is unmuted. Keep `store: false` (the default) unless forking is wanted.

### 4.4 Where the API key lives

Reuse **`main/speech/openai-api-key-store.ts`** (`readOpenAiSpeechApiKey()`), file `~/.dobius/openai-speech-token.enc`, encrypted with `safeStorage`. The Settings dialog already exists. Main reads the key only at the moment it creates a session. The window gets the SDP answer and nothing else.

Carson would need an OpenAI **API** key from the developer platform with billing set up. A ChatGPT Plus or Pro subscription does not include API usage (inferred from how OpenAI bills the two products; not re-checked this session).

### 4.5 Build sequence

Sizes: S = under half a day, M = one to two days, L = longer. All paths under `dobius/src` in the `WORKSTATION-BUILD` worktree.

| # | Task | Size | Files |
|---|---|---|---|
| 1 | **Proof of connection.** Main creates a `gpt-live-1.1` session from an SDP offer using the stored key. No tools yet. | M | New `main/jarvis/openai-live-session.ts` + test. Edit `main/jarvis/jarvis-ipc.ts` (new `jarvis:liveSessionConnect`), `preload/index.ts`, `preload/api-types.ts` |
| 2 | **Live voice hook in the window.** Microphone, WebRTC, `oai-events` channel, states (connecting, listening, speaking, standby), mute and unmute. Copy the generation-guard and idle patterns. | M | New `renderer/src/components/jarvis/use-live-voice.ts` + test, modelled on `use-voice-agent.ts`. Edit `renderer/src/components/dictation/DictationIndicator.tsx` and `VoiceOrb.tsx` to pick the engine |
| 3 | **Settings.** Engine choice (Hermes turns, ElevenLabs, OpenAI Live), voice name, hands-free switch, daily cap, idle timeout. Reuse the existing key dialog. | S | `shared/speech-types.ts`, `shared/constants.ts` (`getDefaultVoiceSettings`), `renderer/src/components/settings/JarvisSettingsSection.tsx`, `renderer/src/components/jarvis/use-jarvis-voice-settings.ts` |
| 4 | **ADAM prompt and starting context.** | S | New `main/jarvis/live-voice-prompt.ts` + test. Reuses `buildAgentContext` in `main/jarvis/agent-context.ts` |
| 5 | **Tools.** Typed tool list, the executor in main, the function-call round trip on the data channel. | M | New `main/jarvis/live-voice-tools.ts` + test. Edit `main/jarvis/agent-context.ts` (export a typed argv runner beside `runDobiusCommand`), `main/jarvis/jarvis-ipc.ts` (`jarvis:liveToolCall`), `use-live-voice.ts` |
| 6 | **Safety layer.** Risk classes, on-screen confirm, action log, interrupt cancels work. | M | New `main/jarvis/live-voice-policy.ts` + test. Edit `main/jarvis/jarvis-ipc.ts` (share the approval box) |
| 7 | **Spend meter and cap.** | S | New `main/jarvis/live-voice-meter.ts` + test. Store under the user-data folder beside `adam-voice-session.json` |
| 8 | **Reconnect and memory.** Handle `expired` and dropped calls, planned recycle before 2 hours, seed the next session from saved text. Then a 30-minute soak test in the isolated dev copy with a screenshot and a meter-versus-dashboard check. | M | New `main/jarvis/live-voice-history.ts` + test. Edit `use-live-voice.ts` |

Order matters: 1 and 2 prove the call works before anything is built on it. Tasks 3 and 4 can run in parallel after that. 5 before 6 before 8.

### 4.6 Reuse versus build new

**Reuse as is:**
- OpenAI key store and its Settings dialog (`main/speech/openai-api-key-store.ts`, `OpenAiTranscriptionKeyDialog.tsx`).
- `AdamHermesVoice` for `ask_adam`, including its approval box and saved session.
- `buildAgentContext`, `buildOpeningLine`, `decideDobiusCommand` and `DENIED_VERBS` in `main/jarvis/agent-context.ts`.
- The orb (`VoiceOrb.tsx`, `DictationIndicator.tsx`), the push-to-talk shortcut and the state broadcast in `jarvis-service.ts`.
- The microphone permission handler.
- The approval wording in `conductor-system-prompt.ts`.

**Copy the pattern, new code:**
- `use-voice-agent.ts` (ElevenLabs) is the template for `use-live-voice.ts`.
- `elevenlabs-agent.ts` (main mints access, window connects) is the template for `openai-live-session.ts`.

**Build new:**
- The WebRTC connection and data-channel event handling.
- The typed tool layer, risk classes and action log.
- The spend meter and cap.
- Reconnect and session memory.

**Do not port for this feature:**
- Barge-in, silence detection and the streaming voice brain from the old voice branch. The model does these.
- Sam's whisper server and Kokoro. They solve the offline, turn-based case.

**Still worth a decision:** the offline "Hey Adam" wake word from the old branch. It is the only way to start a session by voice while nothing paid is running.

---

## 5. Open questions for Carson

1. **Which model?** `gpt-live-1.1` (per-minute, standby, natural conversation) or `gpt-realtime-2.1` (per-token, true push-to-talk, the voice model calls tools itself).
   Recommended default: **`gpt-live-1.1`**. It is the one he named, and standby pricing suits an all-day session.
2. **Who is the brain?** An OpenAI backend model with ADAM's tools, with real Hermes ADAM one tool call away. Or Hermes ADAM as the only brain.
   Recommended default: **OpenAI backend plus `ask_adam`** for version 1. Simpler and faster to build. Revisit after a week of use.
   **DECIDED 2026-11-22 by Carson: Hermes ADAM is the only brain. Voice is a tool ADAM uses, not a second agent.** Build `client` delegation, not a separate OpenAI backend brain. Everything said out loud (Carson's words and ADAM's spoken reply, from the transcript events) is written into the same Board thread and the same Hermes ADAM session as typed messages. One conversation, two ways in.
3. **Always listening or push-to-talk?**
   Recommended default: **muted until the shortcut is pressed**. Hands-free is a switch he turns on when he wants it.
4. **Daily spend cap?**
   Recommended default: **$15 per day**, warning at 80%, hard stop at 100%.
5. **What needs an on-screen click?**
   Recommended default: **anything outward or destructive, and anything that starts new paid agents**. Creating tasks and messaging existing terminals need only a spoken read-back.
6. **Is it OK for microphone audio to go to OpenAI?** Sam's design kept audio on the Mac.
   Recommended default: **yes, only while unmuted, with recording storage off**.
7. **Does Carson have an OpenAI API key with billing, and access to `gpt-live-1.1`?** The key already saved for transcription may work.
   Recommended default: **reuse the saved key and test it in task 1**. If access is missing, that is the first blocker.
8. **Which voice?** The default is `marin`. It cannot change mid-session.
   Recommended default: **start with `marin`**, pick a final voice after hearing three.
9. **Keep ElevenLabs?**
   Recommended default: **keep it as a fallback for now**, remove it once the OpenAI path has run for two weeks.
10. **Desktop only, or the phone too?**
    Recommended default: **desktop first**. The phone can come later through the same main-process session broker.

## Confidence

- **Verified against OpenAI pages this session:** the model name, both prices, the endpoint, the WebRTC handshake, the delegation modes and events, standby settings, mute events, context limits, forking, the Realtime 60-minute limit and Realtime token rates.
- **Verified against source this session:** every file path, line number and command flag in sections 2 and 4, and every commit in section 3.
- **Estimated:** all dollar totals for a day. The arithmetic is shown.
- **Unverified:** the items in section 1.8, how well mute-based push-to-talk works on `gpt-live-1.1`, and whether the saved key has Live API access.
- **Note on method:** web pages were read through a summarizing fetch tool. Quotes are as that tool returned them. Anything load-bearing for money (the two per-minute prices) was checked on two separate pages.
