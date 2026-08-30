import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { net } from 'electron'
import { getSherpaModulePath } from './sherpa-module-path'
import { resolveTarExecutable } from './tar-executable'

export type LocalTtsEngine = 'kokoro' | 'supertonic'

export type TtsAudio = { samples: Float32Array; sampleRate: number }

/** Opaque napi external; the addon has no free() — dropping the ref releases it. */
type SherpaTtsHandle = unknown

export type SherpaTtsModule = {
  createOfflineTtsAsync(config: object): Promise<SherpaTtsHandle>
  offlineTtsGenerateAsync(
    handle: SherpaTtsHandle,
    request: { text: string; sid: number; speed: number; enableExternalBuffer: boolean }
  ): Promise<TtsAudio>
}

export type LocalTtsDeps = {
  /** userData/speech-models — model dirs land beside the STT models. */
  modelsRoot: string
  /** Read at every synthesize call so a settings change needs no restart. */
  getEngine: () => LocalTtsEngine
  loadSherpa?: () => SherpaTtsModule
  downloadToFile?: (url: string, dest: string) => Promise<void>
  extractArchive?: (archivePath: string, destDir: string) => Promise<void>
}

/** Pinned against the sherpa-onnx `tts-models` release assets, verified 2026-08-29. */
export const LOCAL_TTS_ASSETS: Record<LocalTtsEngine, { dirName: string; url: string }> = {
  kokoro: {
    dirName: 'kokoro-int8-multi-lang-v1_1',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2'
  },
  supertonic: {
    dirName: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2'
  }
}

function findEntry(names: string[], dir: string, role: string, test: (name: string) => boolean): string {
  const match = names.find(test)
  if (!match) {
    throw new Error(`Local TTS: no ${role} found in ${dir}. Contents: ${names.join(', ') || '(empty)'}`)
  }
  return join(dir, match)
}

/**
 * Model archives are inspected, not trusted to a pinned file list — each TTS
 * family names its files differently and upstream renames between releases.
 * Field names match the native addon's marshalling (probed 2026-08-29: bad
 * paths reach `--kokoro-model ... does not exist`, proving the key names).
 */
export function buildKokoroConfig(modelDir: string): object {
  const entries = readdirSync(modelDir, { withFileTypes: true })
  const files = entries.filter((e) => e.isFile()).map((e) => e.name)
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  const lexicon = files
    .filter((f) => f.startsWith('lexicon') && f.endsWith('.txt'))
    .map((f) => join(modelDir, f))
    .join(',')
  return {
    model: {
      kokoro: {
        model: findEntry(files, modelDir, 'model (*.onnx)', (f) => f.endsWith('.onnx')),
        voices: findEntry(files, modelDir, 'voices.bin', (f) => f === 'voices.bin'),
        tokens: findEntry(files, modelDir, 'tokens.txt', (f) => f === 'tokens.txt'),
        dataDir: dirs.includes('espeak-ng-data') ? join(modelDir, 'espeak-ng-data') : '',
        dictDir: dirs.includes('dict') ? join(modelDir, 'dict') : '',
        lexicon,
        lang: ''
      },
      numThreads: 2,
      provider: 'cpu',
      debug: 0
    },
    maxNumSentences: 1
  }
}

export function buildSupertonicConfig(modelDir: string): object {
  const files = readdirSync(modelDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
  const onnx = (part: string) => (f: string) => f.includes(part) && f.endsWith('.onnx')
  const json = (part: string) => (f: string) => f.includes(part) && f.endsWith('.json')
  return {
    model: {
      supertonic: {
        durationPredictor: findEntry(files, modelDir, 'duration predictor', onnx('duration')),
        textEncoder: findEntry(files, modelDir, 'text encoder', onnx('text_encoder')),
        vectorEstimator: findEntry(files, modelDir, 'vector estimator', onnx('estimator')),
        ttsJson: findEntry(files, modelDir, 'tts.json', (f) => f === 'tts.json'),
        unicodeIndexer: findEntry(files, modelDir, 'unicode indexer', json('indexer')),
        voiceStyle: findEntry(files, modelDir, 'voice style', json('style'))
      },
      numThreads: 2,
      provider: 'cpu',
      debug: 0
    },
    maxNumSentences: 1
  }
}

async function downloadViaElectronNet(url: string, dest: string): Promise<void> {
  // Why net.fetch: it honors the app's proxy settings, unlike Node's fetch.
  if (new URL(url).protocol !== 'https:') {
    throw new Error('Model downloads must use HTTPS')
  }
  const response = await net.fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed: HTTP ${response.status}`)
  }
  await pipeline(
    Readable.fromWeb(response.body as unknown as WebReadableStream),
    createWriteStream(dest)
  )
}

function extractTarBz2(archivePath: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  return new Promise((resolve, reject) => {
    // Why spawn over exec: bzip2 decompression of a 140MB archive is minutes of
    // streamed stderr; exec's maxBuffer can kill it silently (see ModelManager).
    const child = spawn(
      resolveTarExecutable(),
      ['-xjf', archivePath, '-C', destDir, '--strip-components=1'],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }
    )
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Extraction timed out after 10 minutes'))
    }, 600_000)
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`tar exited with code ${code}: ${stderr.slice(0, 500)}`))
      }
    })
  })
}

/**
 * Lazy, releasable wrapper around sherpa-onnx offline TTS.
 *
 * Models load on the FIRST synthesize call, never at startup (this machine has
 * 16 GB and is under pressure), and release() drops every native ref so the
 * ~300 MB of model memory can be reclaimed. Loading and generation both use
 * the addon's async variants, so the Electron main thread never blocks.
 */
export class LocalTts {
  private readonly deps: LocalTtsDeps
  private sherpa: SherpaTtsModule | null = null
  private loaded: { engine: LocalTtsEngine; handle: Promise<SherpaTtsHandle> } | null = null

  constructor(deps: LocalTtsDeps) {
    this.deps = deps
  }

  /** Downloads + extracts the pinned archive if absent. The tarball never survives. */
  async ensureModel(engine: LocalTtsEngine): Promise<string> {
    const asset = LOCAL_TTS_ASSETS[engine]
    if (!asset) {
      // Settings come from a hand-editable JSON file; fail with a name, not a
      // TypeError three frames down.
      throw new Error(`Unknown local TTS engine: ${String(engine)}`)
    }
    const modelDir = join(this.deps.modelsRoot, asset.dirName)
    if (existsSync(modelDir) && readdirSync(modelDir).length > 0) {
      return modelDir
    }
    mkdirSync(this.deps.modelsRoot, { recursive: true })
    const archivePath = join(this.deps.modelsRoot, `${asset.dirName}.tar.bz2`)
    try {
      await (this.deps.downloadToFile ?? downloadViaElectronNet)(asset.url, archivePath)
      await (this.deps.extractArchive ?? extractTarBz2)(archivePath, modelDir)
    } catch (error) {
      // A half-extracted dir would read as "present" next time; remove it.
      rmSync(modelDir, { recursive: true, force: true })
      throw error
    } finally {
      // Disk is at 8.4 GB free — the archive is deleted on success AND failure.
      rmSync(archivePath, { force: true })
    }
    return modelDir
  }

  async synthesize(text: string): Promise<TtsAudio> {
    const engine = this.deps.getEngine()
    if (this.loaded && this.loaded.engine !== engine) {
      this.release()
    }
    if (!this.loaded) {
      this.loaded = { engine, handle: this.load(engine) }
    }
    const loading = this.loaded
    let handle: SherpaTtsHandle
    try {
      handle = await loading.handle
    } catch (error) {
      // A failed load must not be cached as "loaded" forever.
      if (this.loaded === loading) {
        this.loaded = null
      }
      throw error
    }
    return this.getSherpa().offlineTtsGenerateAsync(handle, {
      text,
      sid: 0,
      speed: 1.0,
      enableExternalBuffer: true
    })
  }

  release(): void {
    this.loaded = null
  }

  private getSherpa(): SherpaTtsModule {
    this.sherpa ??= (this.deps.loadSherpa ?? defaultLoadSherpa)()
    return this.sherpa
  }

  private async load(engine: LocalTtsEngine): Promise<SherpaTtsHandle> {
    const modelDir = await this.ensureModel(engine)
    const config = engine === 'kokoro' ? buildKokoroConfig(modelDir) : buildSupertonicConfig(modelDir)
    return this.getSherpa().createOfflineTtsAsync(config)
  }
}

function defaultLoadSherpa(): SherpaTtsModule {
  // Same native addon (and resolution rules) the STT worker uses.
  return require(getSherpaModulePath()) as SherpaTtsModule
}
