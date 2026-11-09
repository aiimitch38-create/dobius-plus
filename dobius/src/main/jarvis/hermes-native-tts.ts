import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { resolveAdamHermesRuntime } from './adam-hermes-runtime'

export type NativeVoiceOutcome = { played: true } | { played: false; reason: string }

const DEFAULT_EDGE_VOICE = 'en-US-AndrewNeural'
const SYNTH_TIMEOUT_MS = 20_000
const PLAY_TIMEOUT_MS = 60_000

// Why read config.yaml directly instead of a Hermes RPC call: this runs
// before/alongside a session, and the voice choice is a static profile
// setting — no need to pay for a round trip into the running agent for it.
async function resolveEdgeVoice(profileHome: string): Promise<string> {
  try {
    const raw = await readFile(join(profileHome, 'config.yaml'), 'utf8')
    const config = parse(raw) as { tts?: { provider?: string; edge?: { voice?: string } } }
    if (config?.tts?.provider === 'edge' && config.tts.edge?.voice) {
      return config.tts.edge.voice
    }
  } catch {
    // Missing/unreadable config falls back to the default voice below.
  }
  return DEFAULT_EDGE_VOICE
}

// Runs inline (-c) rather than a checked-in .py file: this is five lines, and
// a separate file would need its own install/packaging story for no benefit.
const SYNTH_SCRIPT = `
import asyncio, sys, edge_tts

async def main():
    text, voice, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    await edge_tts.Communicate(text, voice).save(out_path)

asyncio.run(main())
`

function runPython(python: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(python, ['-c', SYNTH_SCRIPT, ...args], { timeout: SYNTH_TIMEOUT_MS }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function playFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('afplay', [filePath], { timeout: PLAY_TIMEOUT_MS }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

/**
 * Speaks `text` as Adam, through his own Hermes profile's configured voice
 * (Edge TTS by default — free, local, no ElevenLabs key). macOS only for now
 * (afplay); other platforms report unavailable so the caller's existing
 * fallback chain (ElevenLabs, then the OS `say` engine) still runs.
 */
export async function speakWithHermesNativeVoice(
  text: string,
  platform: NodeJS.Platform = process.platform
): Promise<NativeVoiceOutcome> {
  if (platform !== 'darwin') {
    return { played: false, reason: 'Native Hermes voice is only wired up on macOS right now.' }
  }
  const runtime = await resolveAdamHermesRuntime()
  if (!runtime) {
    return { played: false, reason: "Adam's Hermes profile is not available." }
  }
  const voice = await resolveEdgeVoice(runtime.profileHome)
  const dir = await mkdtemp(join(tmpdir(), 'dobius-adam-voice-'))
  const outPath = join(dir, 'reply.mp3')
  try {
    await runPython(runtime.python, [text, voice, outPath])
    await playFile(outPath)
    return { played: true }
  } catch (error) {
    return {
      played: false,
      reason: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
