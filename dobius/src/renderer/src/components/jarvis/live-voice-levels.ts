import type { LevelReader } from './live-voice-call-types'

/** The orb's input and output level readers for one call; disposed with it. */
export class LiveLevels {
  private readers: Record<'input' | 'output', LevelReader | null> = { input: null, output: null }

  constructor(private readonly levelOf?: (stream: unknown) => LevelReader | null) {}

  set(which: 'input' | 'output', stream: unknown): void {
    this.readers[which]?.dispose()
    this.readers[which] = this.levelOf?.(stream) ?? null
  }

  read(which: 'input' | 'output'): number {
    return this.readers[which]?.read() ?? 0
  }

  dispose(): void {
    this.readers.input?.dispose()
    this.readers.output?.dispose()
    this.readers = { input: null, output: null }
  }
}
