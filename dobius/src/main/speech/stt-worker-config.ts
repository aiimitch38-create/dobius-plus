import { readdirSync } from 'node:fs'

/**
 * Pure config-building for the STT worker. Bundled into the worker thread —
 * keep this module free of electron imports.
 */

// Why: different models name their ONNX files differently (e.g.
// encoder.int8.onnx vs tiny-encoder.onnx vs encoder-epoch-99-avg-1.onnx).
// We resolve the actual path from the manifest's files list by searching
// for the role name anywhere in the filename.
export function resolveFile(files: string[], role: string, modelDir: string, ext = '.onnx'): string {
  const match = files.find((f) => f.includes(role) && f.endsWith(ext))
  if (!match) {
    throw new Error(`No *${role}*${ext} found in model files: ${files.join(', ')}`)
  }
  return `${modelDir}/${match}`
}

export function resolveTokens(files: string[], modelDir: string): string {
  const match = files.find((f) => f.endsWith('tokens.txt'))
  if (!match) {
    throw new Error(`No *tokens.txt found in model files: ${files.join(', ')}`)
  }
  return `${modelDir}/${match}`
}

// Why: BPE models need a vocab file for hotwords token matching. The file
// ships in the model archive but isn't listed in the manifest. We discover
// it at runtime to avoid breaking existing downloads.
export function discoverBpeVocab(modelDir: string): string | undefined {
  try {
    const entries = readdirSync(modelDir)
    const vocabFile = entries.find((f) => f.endsWith('.vocab'))
    return vocabFile ? `${modelDir}/${vocabFile}` : undefined
  } catch {
    return undefined
  }
}

export type HotwordsInit = {
  modelType: string
  modelDir: string
  hotwordsFilePath?: string
  modelingUnit?: string
}

export function buildHotwordsConfig(msg: HotwordsInit): {
  decodingMethod: string
  hotwordsFile?: string
  hotwordsScore?: number
  modelingUnit?: string
  bpeVocab?: string
} {
  if (msg.modelType !== 'transducer' || !msg.hotwordsFilePath) {
    return { decodingMethod: 'greedy_search' }
  }

  const unit = msg.modelingUnit
  if (unit?.includes('bpe')) {
    const bpeVocab = discoverBpeVocab(msg.modelDir)
    if (!bpeVocab) {
      return { decodingMethod: 'greedy_search' }
    }
    return {
      decodingMethod: 'modified_beam_search',
      hotwordsFile: msg.hotwordsFilePath,
      hotwordsScore: 1.5,
      modelingUnit: unit,
      bpeVocab
    }
  }

  return {
    decodingMethod: 'modified_beam_search',
    hotwordsFile: msg.hotwordsFilePath,
    hotwordsScore: 1.5,
    modelingUnit: unit
  }
}

export type RecognizerInit = HotwordsInit & {
  streaming: boolean
  sampleRate: number
  files: string[]
}

/**
 * Builds the sherpa recognizer config for every supported model family.
 * `online` tells the worker which creator pair to call. The endpoint rules on
 * the streaming configs remain the no-VAD fallback path — when VAD is active
 * the worker ignores `isEndpoint` and uses the silence endpointer instead.
 */
export function buildRecognizerConfig(
  msg: RecognizerInit,
  endOfSpeechSilenceS: number
): { config: object; online: boolean } {
  const { modelDir, modelType, streaming, sampleRate, files } = msg
  const tokens = resolveTokens(files, modelDir)
  const hotwords = buildHotwordsConfig(msg)
  const endpointRules = {
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: endOfSpeechSilenceS,
    rule3MinUtteranceLength: 20
  }

  if (streaming && modelType === 'transducer') {
    return {
      online: true,
      config: {
        featConfig: { sampleRate, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: resolveFile(files, 'encoder', modelDir),
            decoder: resolveFile(files, 'decoder', modelDir),
            joiner: resolveFile(files, 'joiner', modelDir)
          },
          tokens,
          numThreads: 1,
          provider: 'cpu',
          debug: 0
        },
        ...hotwords,
        ...endpointRules
      }
    }
  }
  if (streaming && modelType === 'paraformer') {
    return {
      online: true,
      config: {
        featConfig: { sampleRate, featureDim: 80 },
        modelConfig: {
          paraformer: {
            encoder: resolveFile(files, 'encoder', modelDir),
            decoder: resolveFile(files, 'decoder', modelDir)
          },
          tokens,
          numThreads: 1,
          provider: 'cpu',
          debug: 0
        },
        decodingMethod: 'greedy_search',
        ...endpointRules
      }
    }
  }
  if (modelType === 'whisper') {
    return {
      online: false,
      config: {
        featConfig: { sampleRate, featureDim: 80 },
        modelConfig: {
          whisper: {
            encoder: resolveFile(files, 'encoder', modelDir),
            decoder: resolveFile(files, 'decoder', modelDir)
          },
          tokens,
          numThreads: 2,
          provider: 'cpu',
          debug: 0
        },
        decodingMethod: 'greedy_search'
      }
    }
  }
  return {
    online: false,
    config: {
      featConfig: { sampleRate, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: resolveFile(files, 'encoder', modelDir),
          decoder: resolveFile(files, 'decoder', modelDir),
          joiner: resolveFile(files, 'joiner', modelDir)
        },
        tokens,
        numThreads: 2,
        provider: 'cpu',
        debug: 0
      },
      ...hotwords
    }
  }
}

export type KwsInit = {
  modelDir: string
  files: string[]
  keywordsFilePath: string
}

/** Spotter config; field names verified against the addon binary 2026-08-30. */
export function buildKwsConfig(kws: KwsInit, sampleRate: number): object {
  return {
    featConfig: { sampleRate, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: resolveFile(kws.files, 'encoder', kws.modelDir),
        decoder: resolveFile(kws.files, 'decoder', kws.modelDir),
        joiner: resolveFile(kws.files, 'joiner', kws.modelDir)
      },
      tokens: resolveTokens(kws.files, kws.modelDir),
      numThreads: 1,
      provider: 'cpu',
      debug: 0
    },
    keywordsFile: kws.keywordsFilePath,
    keywordsScore: 1.0,
    keywordsThreshold: 0.25,
    maxActivePaths: 4,
    numTrailingBlanks: 1
  }
}
