import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  LocalTtsEngine,
  TtsBakeoffEngineRun,
  TtsBakeoffResult
} from '../../shared/speech-types'
import type { TtsAudio } from './local-tts'

/**
 * Fixed sentences so runs are comparable across engines and across days:
 * a plain statement, a short imperative, and one dense with numerals.
 */
export const BAKEOFF_SENTENCES = [
  'The build finished cleanly, and every test in the voice scope is green.',
  'Say Adam to interrupt me, and playback stops right away.',
  'Numbers should read naturally: 42 files changed at 9:15 on August 30th, 2026.'
]

export type TtsBakeoffDeps = {
  /** userData/speech-models — WAVs land under bakeoff/, the report beside it. */
  modelsRoot: string
  makeTts: (engine: LocalTtsEngine) => {
    synthesize: (text: string) => Promise<TtsAudio>
    release: () => void
  }
  writeWave: (filename: string, audio: { samples: Float32Array; sampleRate: number }) => void
  now?: () => number
  sentences?: string[]
}

const ENGINES: LocalTtsEngine[] = ['kokoro', 'supertonic']

/**
 * Synthesizes the fixed sentences on both engines, times cold (first synth,
 * including the lazy model load) and warm latency, and writes WAVs plus a
 * markdown report. Quality is Carson's call — this harness cannot listen —
 * but the DEFAULT engine is picked here, by measured warm latency.
 *
 * Engines run sequentially and each is released before the next loads:
 * two loaded TTS models at once would break the 16 GB memory budget.
 */
export async function runTtsBakeoff(deps: TtsBakeoffDeps): Promise<TtsBakeoffResult> {
  const now = deps.now ?? Date.now
  const sentences = deps.sentences ?? BAKEOFF_SENTENCES
  const wavDir = join(deps.modelsRoot, 'bakeoff')
  mkdirSync(wavDir, { recursive: true })

  const runs: TtsBakeoffEngineRun[] = []
  for (const engine of ENGINES) {
    const tts = deps.makeTts(engine)
    const run: TtsBakeoffEngineRun = { engine, ok: false, perSentenceMs: [], wavPaths: [] }
    try {
      for (let index = 0; index < sentences.length; index += 1) {
        const started = now()
        const audio = await tts.synthesize(sentences[index])
        run.perSentenceMs.push(now() - started)
        const wavPath = join(wavDir, `${engine}-${index + 1}.wav`)
        deps.writeWave(wavPath, { samples: audio.samples, sampleRate: audio.sampleRate })
        run.wavPaths.push(wavPath)
      }
      run.coldMs = run.perSentenceMs[0]
      const warm = run.perSentenceMs.slice(1)
      run.warmAvgMs = warm.length
        ? Math.round(warm.reduce((sum, ms) => sum + ms, 0) / warm.length)
        : run.coldMs
      run.ok = true
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error)
    } finally {
      tts.release()
    }
    runs.push(run)
  }

  const completed = runs.filter((run) => run.ok)
  completed.sort((a, b) => (a.warmAvgMs ?? Infinity) - (b.warmAvgMs ?? Infinity))
  const winner = completed[0]?.engine ?? null

  const reportPath = join(deps.modelsRoot, 'BAKEOFF.md')
  writeFileSync(reportPath, formatReport(runs, winner, sentences))
  return { winner, runs, reportPath }
}

function formatReport(
  runs: TtsBakeoffEngineRun[],
  winner: LocalTtsEngine | null,
  sentences: string[]
): string {
  const lines: string[] = [
    '# Local TTS bake-off',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    winner
      ? `**Default engine (by warm latency): \`${winner}\`.**`
      : '**No engine completed — no default chosen.**',
    '',
    'Latency picked the default; it cannot judge QUALITY. Listen to the WAVs',
    'below and override the engine in Settings → Voice if your ears disagree.',
    '',
    '## Sentences',
    '',
    ...sentences.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Results',
    ''
  ]
  for (const run of runs) {
    lines.push(`### ${run.engine}`, '')
    if (run.ok) {
      lines.push(
        `- Cold (first synthesis, incl. model load): ${run.coldMs} ms`,
        `- Warm average: ${run.warmAvgMs} ms`,
        `- Per sentence: ${run.perSentenceMs.map((ms) => `${ms} ms`).join(', ')}`,
        ...run.wavPaths.map((p) => `- WAV: ${p}`)
      )
    } else {
      lines.push(`- FAILED: ${run.error}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
