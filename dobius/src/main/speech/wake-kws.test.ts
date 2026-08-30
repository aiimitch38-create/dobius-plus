import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KWS_MODEL_DIR_NAME,
  KWS_MODEL_URL,
  buildKeywordsLine,
  encodeKeywordTokens,
  ensureKwsModel,
  resolveKwsAssets
} from './wake-kws'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/unused' }, net: {} }))

const GIGASPEECH_LIKE_TOKENS = ['▁A', '▁AD', 'D', 'AM', 'A', 'M', '▁THE', 'B']

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wake-kws-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('encodeKeywordTokens', () => {
  it('greedy longest-match prefers the longest piece at each step', () => {
    // '▁ADAM' → '▁AD' wins over '▁A', then 'AM' over 'A'.
    expect(encodeKeywordTokens('adam', GIGASPEECH_LIKE_TOKENS)).toBe('▁AD AM')
  })

  it('falls back to shorter pieces when long ones are missing', () => {
    expect(encodeKeywordTokens('adam', ['▁A', 'D', 'A', 'M'])).toBe('▁A D A M')
  })

  it('returns null when a span has no piece — KWS stays off, never crashes', () => {
    expect(encodeKeywordTokens('adam', ['▁A', 'D'])).toBeNull()
    expect(encodeKeywordTokens('adam', [])).toBeNull()
  })

  it('keywords line carries the display form', () => {
    expect(buildKeywordsLine('adam', GIGASPEECH_LIKE_TOKENS)).toBe('▁AD AM @adam')
  })
})

describe('resolveKwsAssets', () => {
  function populateModelDir(tokens: string[]): string {
    const dir = join(root, KWS_MODEL_DIR_NAME)
    mkdirSync(dir, { recursive: true })
    for (const f of ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx']) {
      writeFileSync(join(dir, f), 'x')
    }
    writeFileSync(join(dir, 'tokens.txt'), tokens.map((t, i) => `${t} ${i}`).join('\n'))
    return dir
  }

  it('inspects the dir and writes the wake-keywords file once', () => {
    const dir = populateModelDir(GIGASPEECH_LIKE_TOKENS)
    const assets = resolveKwsAssets(root)
    expect(assets?.modelDir).toBe(dir)
    expect(assets?.files).toContain('encoder.int8.onnx')
    expect(readFileSync(assets!.keywordsFilePath, 'utf8')).toBe('▁AD AM @adam\n')
    // Second resolve reuses the written file.
    expect(resolveKwsAssets(root)?.keywordsFilePath).toBe(assets!.keywordsFilePath)
  })

  it('returns null when the model dir is absent', () => {
    expect(resolveKwsAssets(root)).toBeNull()
  })

  it('returns null when the keyword cannot be encoded with this inventory', () => {
    populateModelDir(['▁THE', 'B'])
    expect(resolveKwsAssets(root)).toBeNull()
  })

  it('returns null when transducer files are missing', () => {
    const dir = join(root, KWS_MODEL_DIR_NAME)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'tokens.txt'), '▁A 0')
    expect(resolveKwsAssets(root)).toBeNull()
  })
})

describe('ensureKwsModel', () => {
  it('downloads, extracts, and always deletes the tarball', async () => {
    const archive = join(root, `${KWS_MODEL_DIR_NAME}.tar.bz2`)
    const download = vi.fn(async (_url: string, dest: string) => {
      writeFileSync(dest, 'tar-bytes')
    })
    const extract = vi.fn(async (_a: string, destDir: string) => {
      mkdirSync(destDir, { recursive: true })
      writeFileSync(join(destDir, 'tokens.txt'), '▁A 0')
    })
    await ensureKwsModel(root, download, extract)
    expect(download).toHaveBeenCalledWith(KWS_MODEL_URL, archive)
    expect(existsSync(archive)).toBe(false)
    // Present now — a second ensure is a no-op.
    await ensureKwsModel(root, download, extract)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('removes the half-extracted dir on failure', async () => {
    const download = vi.fn(async (_url: string, dest: string) => {
      writeFileSync(dest, 'tar-bytes')
    })
    const extract = vi.fn(async (_a: string, destDir: string) => {
      mkdirSync(destDir, { recursive: true })
      throw new Error('tar died')
    })
    await expect(ensureKwsModel(root, download, extract)).rejects.toThrow('tar died')
    expect(existsSync(join(root, KWS_MODEL_DIR_NAME))).toBe(false)
    expect(existsSync(join(root, `${KWS_MODEL_DIR_NAME}.tar.bz2`))).toBe(false)
  })
})
