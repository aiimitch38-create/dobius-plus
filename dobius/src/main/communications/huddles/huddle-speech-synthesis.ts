/**
 * Text-to-speech for `speak_agent_message`. Dobius has no TTS engine
 * anywhere else in the codebase (only STT — see src/main/speech/), so this
 * is genuinely new machinery: it shells out to each OS's built-in speech
 * synthesizer rather than adding a TTS dependency.
 *
 * Why the native backend must PLAY the audio (not return bytes for the
 * renderer to play): the vendored `useTtsSubscription.ts` calls
 * `invoke("speak_agent_message", { text })` and never reads the resolved
 * value — the Tauri/Rust command played audio directly through the OS
 * (rodio), fire-and-forget. Matching that contract means synthesis has to
 * produce audible sound on this process's turn, not hand back a buffer.
 *
 * Known limitation (see the build report's RISKS section): OS-native
 * synthesizers speak through the system's *default* output device. None of
 * them expose a "play to this specific device" argument, so a huddle
 * participant's non-default output device selection (`set_audio_output_device`,
 * handled entirely client-side — see PER_COMMAND) is not honored by agent
 * speech. Routing synthesized audio to an arbitrary device would require a
 * native audio module Dobius does not have; this is the one honestly-missing
 * piece of machinery in this feature.
 */
import { execFile } from 'node:child_process'

const MAX_TTS_TEXT_LENGTH = 2_000

export type SpeakOutcome = { played: true; engine: string } | { played: false; reason: string }

/** Runs a synthesis command to completion. Injected so tests never spawn real processes. */
export type SpeakRunner = (command: string, args: string[]) => Promise<void>

function defaultRunner(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function clampText(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MAX_TTS_TEXT_LENGTH ? `${trimmed.slice(0, MAX_TTS_TEXT_LENGTH)}…` : trimmed
}

/**
 * `text` is untrusted content that reaches this module from the relay (an
 * agent's reply, ultimately attacker-influenceable). Passed as a bare argv
 * element, a leading `-` lets it be parsed as a FLAG by the speech binary's
 * own arg parser instead of spoken text (e.g. `say`'s `-o <file>`) — this is
 * argument injection, not shell injection (execFile already avoids that).
 * Every platform speaker below additionally puts `--` ahead of the text to
 * end option parsing, but belt-and-braces: neutralize a leading `-` here too,
 * in case a given binary/build does not honor `--`.
 */
function neutralizeLeadingDash(text: string): string {
  return text.startsWith('-') ? ` ${text}` : text
}

/** PowerShell single-quoted string escaping: double any embedded single quote. */
function escapePowerShellSingleQuoted(text: string): string {
  return text.replace(/'/g, "''")
}

type PlatformSpeaker = {
  engine: string
  speak: (runner: SpeakRunner, text: string) => Promise<void>
}

const MAC_SPEAKER: PlatformSpeaker = {
  engine: 'say',
  speak: (runner, text) => runner('say', ['--', text])
}

const WINDOWS_SPEAKER: PlatformSpeaker = {
  engine: 'powershell',
  speak: (runner, text) => {
    const escaped = escapePowerShellSingleQuoted(text)
    const script = `Add-Type -AssemblyName System.Speech; ` +
      `$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
      `$speaker.Speak('${escaped}');`
    return runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  }
}

// Why two candidates: speech-dispatcher (spd-say) is the common desktop
// default, espeak-ng the common headless fallback. Neither is guaranteed
// installed — a Linux box with neither gets a clear "unavailable" error
// rather than a silent no-op or a fabricated success.
const LINUX_SPEAKERS: PlatformSpeaker[] = [
  { engine: 'spd-say', speak: (runner, text) => runner('spd-say', ['--wait', '--', text]) },
  { engine: 'espeak-ng', speak: (runner, text) => runner('espeak-ng', ['--', text]) },
  { engine: 'espeak', speak: (runner, text) => runner('espeak', ['--', text]) }
]

async function speakOnLinux(runner: SpeakRunner, text: string): Promise<SpeakOutcome> {
  let lastError: unknown
  for (const speaker of LINUX_SPEAKERS) {
    try {
      await speaker.speak(runner, text)
      return { played: true, engine: speaker.engine }
    } catch (error) {
      lastError = error
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError)
  return {
    played: false,
    reason: `No TTS engine available (tried spd-say, espeak-ng, espeak): ${message}`
  }
}

/**
 * Synthesizes and plays `text` through the system's default audio output.
 * `runner` defaults to actually spawning a process; tests inject a fake to
 * exercise platform selection and error handling without touching hardware.
 */
export async function speakText(
  text: string,
  platform: NodeJS.Platform = process.platform,
  runner: SpeakRunner = defaultRunner
): Promise<SpeakOutcome> {
  const clamped = clampText(text)
  if (!clamped) {
    return { played: false, reason: 'empty text' }
  }
  const safe = neutralizeLeadingDash(clamped)

  try {
    if (platform === 'darwin') {
      await MAC_SPEAKER.speak(runner, safe)
      return { played: true, engine: MAC_SPEAKER.engine }
    }
    if (platform === 'win32') {
      await WINDOWS_SPEAKER.speak(runner, safe)
      return { played: true, engine: WINDOWS_SPEAKER.engine }
    }
    if (platform === 'linux') {
      return await speakOnLinux(runner, safe)
    }
    return { played: false, reason: `TTS not supported on platform "${platform}"` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { played: false, reason: message }
  }
}

/**
 * Serializes concurrent speak calls so overlapping agent replies don't
 * garble into simultaneous audio. Each call still resolves with its own
 * outcome; a failed synthesis does not block the next one in line.
 */
export function createHuddleSpeechQueue(
  platform: NodeJS.Platform = process.platform,
  runner: SpeakRunner = defaultRunner
): (text: string) => Promise<SpeakOutcome> {
  let tail: Promise<unknown> = Promise.resolve()

  return (text: string) => {
    const outcome = tail.then(() => speakText(text, platform, runner))
    // Swallow rejections in the chain itself (speakText never rejects, but
    // stay defensive) so one failure cannot wedge every call after it.
    tail = outcome.catch(() => undefined)
    return outcome
  }
}

let singletonQueue: ((text: string) => Promise<SpeakOutcome>) | null = null

/** Process-wide speech queue used by the `speak_agent_message` RPC method. */
export function getHuddleSpeechQueue(): (text: string) => Promise<SpeakOutcome> {
  singletonQueue ??= createHuddleSpeechQueue()
  return singletonQueue
}

/** Test-only reset hook. */
export function resetHuddleSpeechQueueForTests(): void {
  singletonQueue = null
}
