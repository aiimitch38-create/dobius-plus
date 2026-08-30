import { ipcMain } from 'electron'
import { getDefaultVoiceSettings } from '../../shared/constants'
import type { VoiceSettings } from '../../shared/speech-types'
import type { Store } from '../persistence'
import { LocalTts } from '../speech/local-tts'
import { getSherpaModulePath } from '../speech/sherpa-module-path'
import { getLocalTts, getSpeechModelManager } from '../speech/speech-runtime-service'
import { runTtsBakeoff } from '../speech/tts-bakeoff'

/**
 * Registered from the jarvis IPC layer rather than ipc/speech.ts: the voice
 * build's blast radius covers jarvis/, and the bake-off is Adam's concern
 * (which voice he speaks with), not the dictation stack's.
 */
let inFlight: Promise<unknown> | null = null

export function registerTtsBakeoffHandler(store: Store): void {
  ipcMain.removeHandler('speech:runBakeoff')
  ipcMain.handle('speech:runBakeoff', () => {
    // A double-click must not run two bake-offs: each loads a model, and two
    // resident models break the 16 GB budget. Second caller joins the first.
    inFlight ??= runBakeoffOnce(store).finally(() => {
      inFlight = null
    })
    return inFlight
  })
}

async function runBakeoffOnce(store: Store): Promise<unknown> {
  const modelsRoot = getSpeechModelManager(store).getModelsDir()
  // Free the speak path's loaded model first — the bake-off loads each
  // engine itself, and this machine cannot afford two models resident.
  getLocalTts(store).release()
  const sherpa = require(getSherpaModulePath()) as {
    writeWave: (filename: string, audio: { samples: Float32Array; sampleRate: number }) => void
  }
  const result = await runTtsBakeoff({
    modelsRoot,
    makeTts: (engine) => new LocalTts({ modelsRoot, getEngine: () => engine }),
    writeWave: (filename, audio) => sherpa.writeWave(filename, audio)
  })
  if (result.winner) {
    // The measured default; Carson listens to the WAVs and can override in
    // Settings — the report says so explicitly.
    const current = store.getSettings().voice ?? getDefaultVoiceSettings()
    const patch: Partial<VoiceSettings> = { localTtsEngine: result.winner }
    store.updateSettings({ voice: { ...current, ...patch } }, { notifyListeners: true })
  }
  return result
}
