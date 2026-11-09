# Plan: native Hermes voice vs. ElevenLabs for Adam

Status: **scoping only, not yet approved to build.** Carson asked (2026-11-09)
to look into "Hermes voice" on GitHub; this is the result plus a migration
scope. See [`VISION.md`](../VISION.md) for why this matters (cheap/free,
Adam as a real presence, not a puppet).

## What I found on GitHub

Hermes Agent (the open-source engine Adam's "brain" runs on) **already ships
with built-in voice** — it can speak replies aloud and transcribe voice input
— using cloud defaults (Microsoft Edge TTS, Groq/OpenAI Whisper). A plugin
ecosystem swaps those defaults for fully local/free engines:

- **`jamiepine/hermes-voicebox`** — swaps Hermes's built-in TTS/STT for
  [Voicebox](https://voicebox.sh) (voice cloning + local Whisper). Pure
  plumbing swap, no new agent behavior, nothing leaves the machine.
- **`l0cut15/hermes-voice-assistant`**, **`Cosmekaili-creator/Hermes-Voice`** —
  push-to-talk / realtime voice UIs built directly against Hermes, no
  third-party voice vendor.
- Several Home Assistant / hardware-focused projects (`majorminorlabs/hermes-voice`,
  `rusty4444/hermes-voice-ha-integration`, etc.) — not directly relevant to a
  desktop app, but confirm the pattern: Hermes profiles expose an
  OpenAI-compatible `/v1/chat/completions`-style endpoint per profile, and
  personality lives in a profile's `SOUL.md`.

## What's actually wired in Dobius today (confirmed by reading the code)

- `src/main/jarvis/adam-hermes-runtime.ts` spawns Hermes's `tui_gateway`
  process for Adam's profile (`~/.hermes/profiles/adam`) — and **explicitly
  sets `HERMES_VOICE: '0'` and `HERMES_VOICE_TTS: '0'`**, turning Hermes's own
  native voice off on purpose. This spawn path backs terminal/self-edit
  sessions on the Board, not the live voice call.
- The live voice call runs through one of two separate paths, neither of
  which uses Hermes's native voice:
  1. **"Jarvis mode"** (`jarvis-service.ts`, used when no ElevenLabs agent id
     is configured) — wake word / PTT → `askAdam()` → HTTP `POST /v1/converse`
     on a separate **"ADAM service"** (its own endpoint + bearer token,
     resolved via `adam-connection.ts`) → spoken via `jarvis:speak`.
  2. **"Agent mode"** (`use-voice-agent.ts`, active now — this is what you're
     actually talking to) — ElevenLabs Conversational AI owns the whole
     conversation and voice. It can call `ask_adam`, which hits the *same*
     `/v1/converse` ADAM service, as one tool among several. ElevenLabs
     decides when to bother asking Adam anything.
- Adam's profile has a real, well-built identity (`SOUL.md`, `ROLE.md`,
  `PLAYBOOK.md`, `RULES.md`, context files under
  `~/.hermes/profiles/adam/context/`) — including a line that says *"I am not
  the separate ADAM service."* Adam himself distinguishes his Hermes profile
  from this other "ADAM service" the voice paths actually call.

## Why this explains "why is he so dumb"

In agent mode (what's live now), the thing doing most of the talking and
deciding is the ElevenLabs agent — a separate, thinner personality hosted on
elevenlabs.io, not Adam's actual SOUL.md identity. It only reaches the real
Adam when it chooses to call `ask_adam`, and even then it's hitting "ADAM
service," which Adam's own identity doc says is a *different thing* from his
Hermes profile. There are potentially three distinct "voices" involved
(ElevenLabs agent, ADAM service, Hermes profile `adam`), and the one with the
richest identity (the Hermes profile) is the one least directly in the loop.

## Open / needs investigation before any build decision

1. **What is "ADAM service," concretely?** Is it the Hermes profile `adam`
   exposed a different way (e.g. a long-running gateway instead of
   per-session spawn), or a genuinely separate codebase/service? `adam-connection.ts`
   and the `adam-service-principal/` + `cloud-job-adam-*` files suggest it may
   involve a cloud/VPS-reachable component — needs a dedicated read-through,
   not a guess.
2. **Does "ADAM service" already proxy to the same SOUL.md identity**, or does
   it have its own separate personality/context? If it already uses the real
   identity, part of "why is he so dumb" may be ElevenLabs' own system
   prompt being thin, independent of this voice-pipeline question.
3. **Latency/architecture fit**: Hermes-native voice assumes a persistent
   session; Dobius currently spawns `tui_gateway` per use for terminal
   sessions. Would native-voice Adam need a persistent Hermes session kept
   warm, and what does that cost (memory, startup time on first use)?

## Recommended phased approach (once the above is resolved)

- **Phase 0 (this doc + the investigation above).** No code changes.
- **Phase 1 — low-risk addition, not a replacement.** Stand up Hermes-native
  voice (TTS first, cheapest to test) as an *alternate* path behind a
  settings toggle, without removing ElevenLabs. Compare: does Adam sound
  more "himself" and know more about the terminal/session context when his
  own Hermes profile is the one speaking?
  - If a local provider is wanted (free, private): `hermes-voicebox` +
    Voicebox running locally is the cleanest match found — no API key, no
    cloud.
- **Phase 2 — decide ElevenLabs' fate.** Keep it as a "nicer voice" option
  layered on top of Hermes-native (TTS can still be swapped independently of
  which brain is driving the conversation), retire it, or keep both behind a
  settings choice. Don't decide this until Phase 1 data exists.
- **Phase 3 — if kept, re-home the actual conversation driver.** Make sure
  whichever path is primary is actually the Hermes `adam` profile with its
  full SOUL.md/ROLE.md identity in the loop for every turn, not just when a
  tool call happens to reach for it.

## Non-goals right now

- Not touching the Adam roam/dock/power-off UI work already shipped
  (build 71) — this is a separate track.
- Not deciding Herald OS integration mechanics here — related (both are
  "what does Adam's body/voice actually run on") but tracked separately in
  `VISION.md`.
