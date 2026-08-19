import { describe, expect, it, vi } from 'vitest'
import { createHuddleSpeechQueue, speakText, type SpeakRunner } from './huddle-speech-synthesis'

describe('speakText', () => {
  it('speaks on macOS via `say`', async () => {
    const runner: SpeakRunner = vi.fn().mockResolvedValue(undefined)
    const outcome = await speakText('hello there', 'darwin', runner)
    expect(outcome).toEqual({ played: true, engine: 'say' })
    expect(runner).toHaveBeenCalledWith('say', ['--', 'hello there'])
  })

  it('speaks on Windows via PowerShell, escaping single quotes', async () => {
    const runner: SpeakRunner = vi.fn().mockResolvedValue(undefined)
    const outcome = await speakText("agent's reply", 'win32', runner)
    expect(outcome).toEqual({ played: true, engine: 'powershell' })
    const [command, args] = vi.mocked(runner).mock.calls[0]
    expect(command).toBe('powershell.exe')
    expect(args.join(' ')).toContain("agent''s reply")
  })

  it('falls back through Linux TTS candidates in order', async () => {
    const runner: SpeakRunner = vi
      .fn()
      .mockRejectedValueOnce(new Error('spd-say: command not found'))
      .mockResolvedValueOnce(undefined)
    const outcome = await speakText('hello', 'linux', runner)
    expect(outcome).toEqual({ played: true, engine: 'espeak-ng' })
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('reports unavailable when no Linux TTS engine exists', async () => {
    const runner: SpeakRunner = vi.fn().mockRejectedValue(new Error('not found'))
    const outcome = await speakText('hello', 'linux', runner)
    expect(outcome.played).toBe(false)
    if (!outcome.played) {
      expect(outcome.reason).toContain('No TTS engine available')
    }
  })

  it('reports an unsupported platform without throwing', async () => {
    const runner: SpeakRunner = vi.fn().mockResolvedValue(undefined)
    const outcome = await speakText('hello', 'freebsd', runner)
    expect(outcome).toEqual({ played: false, reason: 'TTS not supported on platform "freebsd"' })
    expect(runner).not.toHaveBeenCalled()
  })

  it('treats empty/whitespace-only text as a no-op, not an engine call', async () => {
    const runner: SpeakRunner = vi.fn().mockResolvedValue(undefined)
    const outcome = await speakText('   ', 'darwin', runner)
    expect(outcome).toEqual({ played: false, reason: 'empty text' })
    expect(runner).not.toHaveBeenCalled()
  })

  it('surfaces a synthesis failure as a played:false outcome, not a throw', async () => {
    const runner: SpeakRunner = vi.fn().mockRejectedValue(new Error('say: no audio device'))
    const outcome = await speakText('hello', 'darwin', runner)
    expect(outcome).toEqual({ played: false, reason: 'say: no audio device' })
  })

  it('clamps text over the length cap instead of hanging on runaway input', async () => {
    const runner: SpeakRunner = vi.fn().mockResolvedValue(undefined)
    const longText = 'x'.repeat(5_000)
    await speakText(longText, 'darwin', runner)
    const [, args] = vi.mocked(runner).mock.calls[0]
    expect(args[1].length).toBeLessThan(2_100)
    expect(args[1].endsWith('…')).toBe(true)
  })

  describe('argument injection (argv flag smuggling)', () => {
    // `text` is an agent's reply message — untrusted content from the relay.
    // A leading `-` must never be parseable as a flag by the speech binary.
    const HOSTILE_TEXT = '-o /tmp/pwned.aiff hello'

    it('puts `--` ahead of hostile text on macOS, so `say` cannot parse it as -o', async () => {
      const runner: SpeakRunner = vi.fn().mockResolvedValue(undefined)
      await speakText(HOSTILE_TEXT, 'darwin', runner)
      const [command, args] = vi.mocked(runner).mock.calls[0]
      expect(command).toBe('say')
      expect(args[0]).toBe('--')
      // Belt-and-braces neutralization also prefixes a space, so the spoken
      // text is preserved (same words) but the argv element itself never
      // starts with '-' — see the dedicated neutralization test below.
      expect(args[1].trim()).toBe(HOSTILE_TEXT)
    })

    it('puts `--` ahead of hostile text for both espeak-ng and espeak on Linux', async () => {
      const runner: SpeakRunner = vi
        .fn()
        .mockRejectedValueOnce(new Error('spd-say not found'))
        .mockResolvedValueOnce(undefined)
      await speakText(HOSTILE_TEXT, 'linux', runner)
      const espeakNgArgs = vi.mocked(runner).mock.calls[1][1]
      expect(espeakNgArgs[0]).toBe('--')
      expect(espeakNgArgs[1].trim()).toBe(HOSTILE_TEXT)
    })

    it('neutralizes a leading dash even if `--` were not honored (belt and braces)', async () => {
      const runner: SpeakRunner = vi.fn().mockResolvedValue(undefined)
      await speakText(HOSTILE_TEXT, 'darwin', runner)
      const [, args] = vi.mocked(runner).mock.calls[0]
      // The text argv element itself must not start with '-', independent of
      // whether the '--' separator is present or honored.
      expect(args.at(-1)?.startsWith('-')).toBe(false)
    })

    it('leaves ordinary text (no leading dash) unmodified', async () => {
      const runner: SpeakRunner = vi.fn().mockResolvedValue(undefined)
      await speakText('hello there', 'darwin', runner)
      const [, args] = vi.mocked(runner).mock.calls[0]
      expect(args[1]).toBe('hello there')
    })
  })
})

describe('createHuddleSpeechQueue', () => {
  it('serializes overlapping calls in submission order', async () => {
    const order: string[] = []
    const runner: SpeakRunner = vi.fn(async (_command, args) => {
      order.push(args[1])
      await new Promise((resolve) => setTimeout(resolve, args[1] === 'first' ? 20 : 0))
    })
    const speak = createHuddleSpeechQueue('darwin', runner)

    const first = speak('first')
    const second = speak('second')
    await Promise.all([first, second])

    expect(order).toEqual(['first', 'second'])
  })

  it('continues processing the queue after a failed synthesis', async () => {
    const runner: SpeakRunner = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
    const speak = createHuddleSpeechQueue('darwin', runner)

    const firstOutcome = await speak('will fail')
    const secondOutcome = await speak('will succeed')

    expect(firstOutcome.played).toBe(false)
    expect(secondOutcome).toEqual({ played: true, engine: 'say' })
  })
})
