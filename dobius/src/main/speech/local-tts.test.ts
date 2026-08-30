import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_TTS_ASSETS,
  LocalTts,
  buildKokoroConfig,
  buildSupertonicConfig,
  type LocalTtsEngine,
  type SherpaTtsModule
} from './local-tts'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/dobius-local-tts-unused' },
  net: {}
}))

let root: string

function populateKokoroDir(): string {
  const dir = join(root, LOCAL_TTS_ASSETS.kokoro.dirName)
  mkdirSync(join(dir, 'espeak-ng-data'), { recursive: true })
  mkdirSync(join(dir, 'dict'), { recursive: true })
  for (const f of ['model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt']) {
    writeFileSync(join(dir, f), 'x')
  }
  return dir
}

function populateSupertonicDir(): string {
  const dir = join(root, LOCAL_TTS_ASSETS.supertonic.dirName)
  mkdirSync(dir, { recursive: true })
  for (const f of [
    'duration_predictor.int8.onnx',
    'text_encoder.int8.onnx',
    'vector_estimator.int8.onnx',
    'tts.json',
    'unicode_indexer.json',
    'voice_style.json'
  ]) {
    writeFileSync(join(dir, f), 'x')
  }
  return dir
}

function fakeSherpa(): SherpaTtsModule & {
  createOfflineTtsAsync: ReturnType<typeof vi.fn>
  offlineTtsGenerateAsync: ReturnType<typeof vi.fn>
} {
  return {
    createOfflineTtsAsync: vi.fn(async () => ({ native: true })),
    offlineTtsGenerateAsync: vi.fn(async () => ({
      samples: new Float32Array([0.1, 0.2]),
      sampleRate: 24000
    }))
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'local-tts-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('LocalTts.ensureModel', () => {
  it('skips download when the model dir already has files', async () => {
    populateKokoroDir()
    const download = vi.fn()
    const tts = new LocalTts({
      modelsRoot: root,
      getEngine: () => 'kokoro',
      downloadToFile: download,
      extractArchive: vi.fn()
    })
    const dir = await tts.ensureModel('kokoro')
    expect(dir).toBe(join(root, LOCAL_TTS_ASSETS.kokoro.dirName))
    expect(download).not.toHaveBeenCalled()
  })

  it('downloads, extracts, and deletes the tarball on success', async () => {
    const archive = join(root, `${LOCAL_TTS_ASSETS.kokoro.dirName}.tar.bz2`)
    const download = vi.fn(async (_url: string, dest: string) => {
      writeFileSync(dest, 'tarball-bytes')
    })
    const extract = vi.fn(async (_archivePath: string, destDir: string) => {
      mkdirSync(destDir, { recursive: true })
      writeFileSync(join(destDir, 'model.int8.onnx'), 'x')
    })
    const tts = new LocalTts({
      modelsRoot: root,
      getEngine: () => 'kokoro',
      downloadToFile: download,
      extractArchive: extract
    })
    await tts.ensureModel('kokoro')
    expect(download).toHaveBeenCalledWith(LOCAL_TTS_ASSETS.kokoro.url, archive)
    expect(extract).toHaveBeenCalledWith(archive, join(root, LOCAL_TTS_ASSETS.kokoro.dirName))
    expect(existsSync(archive)).toBe(false)
  })

  it('deletes the tarball and the half-extracted dir when extraction fails', async () => {
    const archive = join(root, `${LOCAL_TTS_ASSETS.supertonic.dirName}.tar.bz2`)
    const tts = new LocalTts({
      modelsRoot: root,
      getEngine: () => 'supertonic',
      downloadToFile: vi.fn(async (_url: string, dest: string) => {
        writeFileSync(dest, 'tarball-bytes')
      }),
      extractArchive: vi.fn(async (_archivePath: string, destDir: string) => {
        mkdirSync(destDir, { recursive: true })
        writeFileSync(join(destDir, 'partial.onnx'), 'x')
        throw new Error('tar exited with code 2')
      })
    })
    await expect(tts.ensureModel('supertonic')).rejects.toThrow('tar exited')
    expect(existsSync(archive)).toBe(false)
    expect(existsSync(join(root, LOCAL_TTS_ASSETS.supertonic.dirName))).toBe(false)
  })
})

describe('LocalTts.synthesize', () => {
  it('lazy-loads once and reuses the handle across calls', async () => {
    populateKokoroDir()
    const sherpa = fakeSherpa()
    const tts = new LocalTts({
      modelsRoot: root,
      getEngine: () => 'kokoro',
      loadSherpa: () => sherpa,
      downloadToFile: vi.fn(),
      extractArchive: vi.fn()
    })
    const first = await tts.synthesize('Hello.')
    await tts.synthesize('Again.')
    expect(sherpa.createOfflineTtsAsync).toHaveBeenCalledTimes(1)
    expect(sherpa.offlineTtsGenerateAsync).toHaveBeenCalledTimes(2)
    expect(first.sampleRate).toBe(24000)
    expect(first.samples).toBeInstanceOf(Float32Array)
  })

  it('reloads after release()', async () => {
    populateKokoroDir()
    const sherpa = fakeSherpa()
    const tts = new LocalTts({
      modelsRoot: root,
      getEngine: () => 'kokoro',
      loadSherpa: () => sherpa,
      downloadToFile: vi.fn(),
      extractArchive: vi.fn()
    })
    await tts.synthesize('Hello.')
    tts.release()
    await tts.synthesize('Back.')
    expect(sherpa.createOfflineTtsAsync).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed load', async () => {
    populateKokoroDir()
    const sherpa = fakeSherpa()
    sherpa.createOfflineTtsAsync.mockRejectedValueOnce(new Error('bad config'))
    const tts = new LocalTts({
      modelsRoot: root,
      getEngine: () => 'kokoro',
      loadSherpa: () => sherpa,
      downloadToFile: vi.fn(),
      extractArchive: vi.fn()
    })
    await expect(tts.synthesize('Hello.')).rejects.toThrow('bad config')
    await tts.synthesize('Retry.')
    expect(sherpa.createOfflineTtsAsync).toHaveBeenCalledTimes(2)
  })

  it('releases the old engine and loads the new one when settings flip', async () => {
    populateKokoroDir()
    populateSupertonicDir()
    let engine: LocalTtsEngine = 'kokoro'
    const sherpa = fakeSherpa()
    const tts = new LocalTts({
      modelsRoot: root,
      getEngine: () => engine,
      loadSherpa: () => sherpa,
      downloadToFile: vi.fn(),
      extractArchive: vi.fn()
    })
    await tts.synthesize('Hello.')
    engine = 'supertonic'
    await tts.synthesize('Switched.')
    expect(sherpa.createOfflineTtsAsync).toHaveBeenCalledTimes(2)
    const secondConfig = sherpa.createOfflineTtsAsync.mock.calls[1][0] as {
      model: Record<string, unknown>
    }
    expect(secondConfig.model).toHaveProperty('supertonic')
  })
})

describe('config building from inspected dirs', () => {
  it('kokoro config carries the discovered files, dirs, and joined lexicons', () => {
    const dir = populateKokoroDir()
    const config = buildKokoroConfig(dir) as {
      model: { kokoro: Record<string, string> }
      maxNumSentences: number
    }
    expect(config.model.kokoro.model).toBe(join(dir, 'model.int8.onnx'))
    expect(config.model.kokoro.voices).toBe(join(dir, 'voices.bin'))
    expect(config.model.kokoro.tokens).toBe(join(dir, 'tokens.txt'))
    expect(config.model.kokoro.dataDir).toBe(join(dir, 'espeak-ng-data'))
    expect(config.model.kokoro.dictDir).toBe(join(dir, 'dict'))
    expect(config.model.kokoro.lexicon).toBe(
      `${join(dir, 'lexicon-us-en.txt')},${join(dir, 'lexicon-zh.txt')}`
    )
    expect(config.maxNumSentences).toBe(1)
  })

  it('supertonic config resolves all six roles', () => {
    const dir = populateSupertonicDir()
    const config = buildSupertonicConfig(dir) as { model: { supertonic: Record<string, string> } }
    expect(config.model.supertonic.durationPredictor).toBe(join(dir, 'duration_predictor.int8.onnx'))
    expect(config.model.supertonic.textEncoder).toBe(join(dir, 'text_encoder.int8.onnx'))
    expect(config.model.supertonic.vectorEstimator).toBe(join(dir, 'vector_estimator.int8.onnx'))
    expect(config.model.supertonic.ttsJson).toBe(join(dir, 'tts.json'))
    expect(config.model.supertonic.unicodeIndexer).toBe(join(dir, 'unicode_indexer.json'))
    expect(config.model.supertonic.voiceStyle).toBe(join(dir, 'voice_style.json'))
  })

  it('names the missing role and lists the dir contents when a file is absent', () => {
    const dir = join(root, LOCAL_TTS_ASSETS.kokoro.dirName)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'tokens.txt'), 'x')
    expect(() => buildKokoroConfig(dir)).toThrow(/model \(\*\.onnx\).*tokens\.txt/)
  })
})
