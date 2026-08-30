import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { LocalTtsEngine } from '../../shared/speech-types'
import type { TtsAudio } from './local-tts'
import { BAKEOFF_SENTENCES, runTtsBakeoff } from './tts-bakeoff'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tts-bakeoff-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

type FakeEngine = {
  synthesize: Mock<(text: string) => Promise<TtsAudio>>
  release: Mock<() => void>
}

function makeDeps(perEngineDelayCalls: Record<LocalTtsEngine, number[]>): {
  deps: Parameters<typeof runTtsBakeoff>[0]
  engines: Map<LocalTtsEngine, FakeEngine>
  events: string[]
} {
  const engines = new Map<LocalTtsEngine, FakeEngine>()
  const events: string[] = []
  let clockTime = 0
  const now = (): number => clockTime
  const deps: Parameters<typeof runTtsBakeoff>[0] = {
    modelsRoot: root,
    now,
    makeTts: (engine) => {
      events.push(`create:${engine}`)
      const delays = [...perEngineDelayCalls[engine]]
      const fake: FakeEngine = {
        synthesize: vi.fn(async () => {
          const delay = delays.shift()
          if (delay === undefined) {
            throw new Error(`${engine} synthesis failed`)
          }
          clockTime += delay
          return { samples: new Float32Array([0]), sampleRate: 24000 }
        }),
        release: vi.fn(() => {
          events.push(`release:${engine}`)
        })
      }
      engines.set(engine, fake)
      return fake
    },
    writeWave: vi.fn()
  }
  return { deps, engines, events }
}

describe('runTtsBakeoff', () => {
  it('picks the engine with the lower warm average and records it in the report', async () => {
    // kokoro: cold 900, warm 100+120 → avg 110. supertonic: cold 400, warm 300+340 → avg 320.
    const { deps } = makeDeps({ kokoro: [900, 100, 120], supertonic: [400, 300, 340] })
    const result = await runTtsBakeoff(deps)
    expect(result.winner).toBe('kokoro')
    const kokoro = result.runs.find((r) => r.engine === 'kokoro')
    expect(kokoro?.coldMs).toBe(900)
    expect(kokoro?.warmAvgMs).toBe(110)
    const report = readFileSync(result.reportPath, 'utf8')
    expect(result.reportPath).toBe(join(root, 'BAKEOFF.md'))
    expect(report).toContain('`kokoro`')
    expect(report).toContain('Cold (first synthesis, incl. model load): 900 ms')
    expect(report).toContain(BAKEOFF_SENTENCES[2])
  })

  it('runs engines sequentially and releases each one', async () => {
    const { deps, events } = makeDeps({ kokoro: [10, 10, 10], supertonic: [10, 10, 10] })
    await runTtsBakeoff(deps)
    // Rule 8: the first engine's model is released BEFORE the second loads.
    expect(events).toEqual(['create:kokoro', 'release:kokoro', 'create:supertonic', 'release:supertonic'])
  })

  it('records a failing engine and crowns the survivor', async () => {
    const { deps, engines } = makeDeps({ kokoro: [], supertonic: [10, 10, 10] })
    const result = await runTtsBakeoff(deps)
    expect(result.winner).toBe('supertonic')
    const kokoro = result.runs.find((r) => r.engine === 'kokoro')
    expect(kokoro?.ok).toBe(false)
    expect(kokoro?.error).toContain('kokoro synthesis failed')
    expect(engines.get('kokoro')?.release).toHaveBeenCalled()
    expect(readFileSync(result.reportPath, 'utf8')).toContain('FAILED: kokoro synthesis failed')
  })

  it('reports no winner when both engines fail, and still writes the report', async () => {
    const { deps } = makeDeps({ kokoro: [], supertonic: [] })
    const result = await runTtsBakeoff(deps)
    expect(result.winner).toBeNull()
    expect(existsSync(result.reportPath)).toBe(true)
    expect(readFileSync(result.reportPath, 'utf8')).toContain('No engine completed')
  })

  it('writes one WAV per sentence per engine under bakeoff/', async () => {
    const { deps } = makeDeps({ kokoro: [10, 10, 10], supertonic: [10, 10, 10] })
    const result = await runTtsBakeoff(deps)
    const kokoro = result.runs.find((r) => r.engine === 'kokoro')
    expect(kokoro?.wavPaths).toEqual([
      join(root, 'bakeoff', 'kokoro-1.wav'),
      join(root, 'bakeoff', 'kokoro-2.wav'),
      join(root, 'bakeoff', 'kokoro-3.wav')
    ])
    expect(deps.writeWave).toHaveBeenCalledTimes(6)
  })
})
