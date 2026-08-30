/* oxlint-disable typescript-eslint/no-explicit-any -- sherpa-onnx native addon has no type definitions */
import { parentPort, workerData } from 'node:worker_threads'
import { resampleToRate } from './stt-audio-resample'
import { createSilenceEndpointer, buildSileroVadConfig } from './silence-endpointer'
import type { SilenceEndpointer } from './silence-endpointer'
import { buildKwsConfig, buildRecognizerConfig } from './stt-worker-config'
import type { KwsInit } from './stt-worker-config'

type WorkerMessage =
  | {
      type: 'init'
      modelDir: string
      modelType: string
      streaming: boolean
      sampleRate: number
      files: string[]
      hotwordsFilePath?: string
      modelingUnit?: string
      vadModelPath?: string
      kws?: KwsInit
    }
  | { type: 'feed'; samples: Float32Array; sampleRate: number }
  | { type: 'stop' }
  | { type: 'teardown' }

// Why: the main sherpa-onnx npm package uses WASM which cannot access the host
// filesystem to load model files. We use the platform-specific native addon
// (e.g. sherpa-onnx-darwin-arm64) which has a flat C-style API and direct
// filesystem access. The main thread resolves the correct absolute path
// (dev vs packaged) and passes it via workerData.
let sherpa: any = null
let recognizer: any = null
let stream: any = null
let isStreaming = false
let offlineBuffer: Float32Array[] = []
let offlineSampleRate = 16000
let vad: any = null
let endpointer: SilenceEndpointer | null = null
let kwsSpotter: any = null
let kwsStream: any = null

// Trailing silence (seconds) that ends an utterance once words were decoded.
// ponytail: the tuning knob for how snappy a spoken turn feels — 1.2s reads as
// a lag before every reply; below ~0.5s a mid-sentence breath cuts you off.
// With VAD active the same window applies, but measured on silero's speech
// probability, so non-speech noise no longer holds a turn open.
const END_OF_SPEECH_SILENCE_S = 0.6

function loadSherpa(): any {
  const modulePath = workerData?.sherpaModulePath
  if (!modulePath) {
    throw new Error('workerData.sherpaModulePath is required')
  }
  return require(modulePath)
}

/**
 * VAD and KWS are strictly additive: a broken model file must never take
 * dictation down with it, so each setup failure logs and leaves the feature
 * off rather than posting an error event.
 */
function setupVadAndKws(msg: Extract<WorkerMessage, { type: 'init' }>): void {
  if (msg.vadModelPath) {
    try {
      vad = sherpa.createVoiceActivityDetector(
        buildSileroVadConfig(msg.vadModelPath, msg.sampleRate),
        2
      )
      endpointer = createSilenceEndpointer({ silenceWindowS: END_OF_SPEECH_SILENCE_S })
    } catch (err) {
      vad = null
      endpointer = null
      console.warn('[stt-worker] VAD unavailable, falling back to decoder endpointing:', err)
    }
  }
  if (msg.kws) {
    try {
      kwsSpotter = sherpa.createKeywordSpotter(buildKwsConfig(msg.kws, msg.sampleRate))
      kwsStream = sherpa.createKeywordStream(kwsSpotter)
    } catch (err) {
      kwsSpotter = null
      kwsStream = null
      console.warn('[stt-worker] keyword spotter unavailable:', err)
    }
  }
}

function handleInit(msg: Extract<WorkerMessage, { type: 'init' }>): void {
  try {
    sherpa = loadSherpa()

    const { streaming, sampleRate } = msg
    isStreaming = streaming
    offlineBuffer = []
    offlineSampleRate = sampleRate

    const { config, online } = buildRecognizerConfig(msg, END_OF_SPEECH_SILENCE_S)
    if (online) {
      recognizer = sherpa.createOnlineRecognizer(config)
      stream = sherpa.createOnlineStream(recognizer)
    } else {
      recognizer = sherpa.createOfflineRecognizer(config)
      stream = sherpa.createOfflineStream(recognizer)
    }

    if (streaming) {
      setupVadAndKws(msg)
    }

    parentPort?.postMessage({ type: 'ready' })
  } catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) })
  }
}

function handleFeed(msg: Extract<WorkerMessage, { type: 'feed' }>): void {
  if (!recognizer || !stream) {
    return
  }

  try {
    const inputRate = msg.sampleRate || offlineSampleRate
    // Why: sherpa's native stream aborts the process if one recognizer sees
    // different input rates across chunks. Normalize before crossing the
    // native boundary so device/context changes become recoverable JS state.
    const samples = resampleToRate(msg.samples, inputRate, offlineSampleRate)
    if (isStreaming) {
      sherpa.acceptWaveformOnline(stream, { sampleRate: offlineSampleRate, samples })

      while (sherpa.isOnlineStreamReady(recognizer, stream)) {
        sherpa.decodeOnlineStream(recognizer, stream)
      }

      const resultJson = sherpa.getOnlineStreamResultAsJson(recognizer, stream)
      const result = JSON.parse(resultJson)
      const text = result?.text?.trim()
      if (text) {
        parentPort?.postMessage({ type: 'partial', text })
      }

      feedKeywordSpotter(samples)

      if (vad && endpointer) {
        // End-of-turn by silero speech probability: noise is non-speech here,
        // so it no longer holds the turn open the way decoder silence did.
        sherpa.voiceActivityDetectorAcceptWaveform(vad, samples)
        const decision = endpointer.feed({
          isSpeech: Boolean(sherpa.voiceActivityDetectorIsDetected(vad)),
          durationS: samples.length / offlineSampleRate
        })
        if (decision.endOfTurn) {
          const finalText = result?.text?.trim()
          if (finalText) {
            parentPort?.postMessage({ type: 'final', text: finalText })
          }
          sherpa.reset(recognizer, stream)
        }
      } else if (sherpa.isEndpoint(recognizer, stream)) {
        const finalText = result?.text?.trim()
        if (finalText) {
          parentPort?.postMessage({ type: 'final', text: finalText })
        }
        sherpa.reset(recognizer, stream)
      }
    } else {
      // Why: offline recognizers cannot decode incrementally — they need all
      // audio buffered first, then decoded in one shot when dictation stops.
      offlineBuffer.push(new Float32Array(samples))
    }
  } catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) })
  }
}

function handleStop(): void {
  if (!recognizer || !stream) {
    parentPort?.postMessage({ type: 'stopped' })
    return
  }

  try {
    if (isStreaming) {
      sherpa.inputFinished(stream)
      while (sherpa.isOnlineStreamReady(recognizer, stream)) {
        sherpa.decodeOnlineStream(recognizer, stream)
      }
      const resultJson = sherpa.getOnlineStreamResultAsJson(recognizer, stream)
      const result = JSON.parse(resultJson)
      const text = result?.text?.trim()
      if (text) {
        parentPort?.postMessage({ type: 'final', text })
      }
      stream = sherpa.createOnlineStream(recognizer)
      endpointer?.reset()
    } else {
      // Why: offline recognizer decodes all audio at once — concatenate
      // buffered chunks into a single Float32Array and feed it to the stream.
      const totalLength = offlineBuffer.reduce((sum, chunk) => sum + chunk.length, 0)
      if (totalLength > 0) {
        const combined = new Float32Array(totalLength)
        let offset = 0
        for (const chunk of offlineBuffer) {
          combined.set(chunk, offset)
          offset += chunk.length
        }
        sherpa.acceptWaveformOffline(stream, { sampleRate: offlineSampleRate, samples: combined })
        sherpa.decodeOfflineStream(recognizer, stream)
        const resultJson = sherpa.getOfflineStreamResultAsJson(stream)
        const result = JSON.parse(resultJson)
        const text = result?.text?.trim()
        if (text) {
          parentPort?.postMessage({ type: 'final', text })
        }
      }
      offlineBuffer = []
      stream = sherpa.createOfflineStream(recognizer)
    }
  } catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) })
  }

  parentPort?.postMessage({ type: 'stopped' })
}

/**
 * Runs the wake-keyword spotter over the same mic samples the recognizer
 * sees. A detection is posted to main (barge-in decides what to do with it)
 * and BOTH streams reset — the keyword stream for the next detection, the
 * ASR stream so the turn restarts fresh without TTS bleed captured so far.
 */
function feedKeywordSpotter(samples: Float32Array): void {
  if (!kwsSpotter || !kwsStream) {
    return
  }
  sherpa.acceptWaveformOnline(kwsStream, { sampleRate: offlineSampleRate, samples })
  while (sherpa.isKeywordStreamReady(kwsSpotter, kwsStream)) {
    sherpa.decodeKeywordStream(kwsSpotter, kwsStream)
    const keywordResult = JSON.parse(sherpa.getKeywordResultAsJson(kwsSpotter, kwsStream))
    const keyword = keywordResult?.keyword?.trim()
    if (keyword) {
      parentPort?.postMessage({ type: 'keyword', keyword })
      sherpa.resetKeywordStream(kwsSpotter, kwsStream)
      sherpa.reset(recognizer, stream)
      endpointer?.reset()
    }
  }
}

function handleTeardown(): void {
  stream = null
  recognizer = null
  sherpa = null
  offlineBuffer = []
  vad = null
  endpointer = null
  kwsSpotter = null
  kwsStream = null
  process.exit(0)
}

parentPort?.on('message', (msg: WorkerMessage) => {
  switch (msg.type) {
    case 'init':
      handleInit(msg)
      break
    case 'feed':
      handleFeed(msg)
      break
    case 'stop':
      handleStop()
      break
    case 'teardown':
      handleTeardown()
      break
  }
})
