import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertEnoughMemoryForModel,
  estimateModelBytes,
  SttOutOfMemoryError,
} from './stt-memory-preflight'

const MB = 1_000_000

let modelDir: string

beforeAll(() => {
  modelDir = mkdtempSync(join(tmpdir(), 'stt-preflight-'))
  writeFileSync(join(modelDir, 'encoder.int8.onnx'), Buffer.alloc(10 * MB))
  writeFileSync(join(modelDir, 'decoder.int8.onnx'), Buffer.alloc(2 * MB))
  writeFileSync(join(modelDir, 'tokens.txt'), 'not a weight file')
})

afterAll(() => {
  rmSync(modelDir, { recursive: true, force: true })
})

const FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt']

describe('estimateModelBytes', () => {
  it('sums only weight files, ignoring vocab and config', () => {
    expect(estimateModelBytes(modelDir, FILES)).toBe(12 * MB)
  })

  it('treats missing files as zero rather than throwing', () => {
    expect(estimateModelBytes(modelDir, ['nope.onnx'])).toBe(0)
  })
})

describe('assertEnoughMemoryForModel', () => {
  it('throws when free memory is far below the model size', () => {
    // The real crash: 622 MB model, ~67 MB free.
    expect(() => assertEnoughMemoryForModel(modelDir, FILES, 1 * MB)).toThrow(
      SttOutOfMemoryError,
    )
  })

  it('allows the load when memory is comfortable', () => {
    expect(() => assertEnoughMemoryForModel(modelDir, FILES, 500 * MB)).not.toThrow()
  })

  it('allows the load at exactly the required ratio', () => {
    // 12 MB model * 0.75 ratio = 9 MB required.
    expect(() => assertEnoughMemoryForModel(modelDir, FILES, 9 * MB)).not.toThrow()
  })

  it('does not block when the model size cannot be determined', () => {
    expect(() => assertEnoughMemoryForModel(modelDir, ['missing.onnx'], 0)).not.toThrow()
  })

  it('reports both numbers so the message is actionable', () => {
    try {
      assertEnoughMemoryForModel(modelDir, FILES, 1 * MB)
      expect.unreachable('should have thrown')
    } catch (error) {
      const err = error as SttOutOfMemoryError
      expect(err.requiredBytes).toBe(9 * MB)
      expect(err.freeBytes).toBe(1 * MB)
      expect(err.message).toContain('9 MB')
    }
  })
})
