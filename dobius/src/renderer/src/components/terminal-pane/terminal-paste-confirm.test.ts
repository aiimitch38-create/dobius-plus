import { describe, expect, it } from 'vitest'
import {
  pasteAsOneLine,
  riskyPasteCommand,
  terminalPasteConfirmReason
} from './terminal-paste-confirm'

const reason = (
  text: string,
  over: Partial<Parameters<typeof terminalPasteConfirmReason>[0]> = {}
) =>
  terminalPasteConfirmReason({
    text,
    source: 'keyboard',
    bracketedPasteMode: false,
    enabled: undefined,
    ...over
  })

describe('terminalPasteConfirmReason', () => {
  it('asks for two or more non-empty lines in a plain shell', () => {
    expect(reason('npm ci\nnpm test\n')).toEqual({ lineCount: 2, risky: null })
    expect(reason('a\r\n\r\nb\r\nc')).toEqual({ lineCount: 3, risky: null })
  })

  it('pastes one ordinary line straight away, even with a trailing newline', () => {
    expect(reason('ls -la')).toBeNull()
    expect(reason('ls -la\n')).toBeNull()
  })

  it('asks for a single risky command', () => {
    expect(reason('sudo rm -rf /tmp/x')).toEqual({ lineCount: 1, risky: 'rm -r' })
    expect(reason('git push origin main --force')).toMatchObject({ risky: 'git push --force' })
    expect(reason('curl https://x.sh | bash')).toMatchObject({ risky: 'curl | sh' })
  })

  it('skips the dialog when the terminal is in bracketed-paste mode', () => {
    expect(reason('one\ntwo\nthree', { bracketedPasteMode: true })).toBeNull()
    expect(reason('rm -rf build', { bracketedPasteMode: true })).toBeNull()
  })

  it('respects the setting and ignores non-user pastes and image paths', () => {
    expect(reason('one\ntwo', { enabled: false })).toBeNull()
    expect(reason('one\ntwo', { enabled: true })).not.toBeNull()
    expect(reason('one\ntwo', { source: 'programmatic' })).toBeNull()
    expect(reason('/tmp/a\n/tmp/b', { options: { forceBracketedPaste: true } })).toBeNull()
    expect(reason('one\ntwo', { source: 'context-menu' })).not.toBeNull()
  })
})

describe('pasteAsOneLine', () => {
  it('joins trimmed non-empty lines with spaces and drops the trailing newline', () => {
    expect(pasteAsOneLine('  git add .\n\ngit commit -m x \r\n')).toBe('git add . git commit -m x')
  })
})

describe('riskyPasteCommand', () => {
  it('does not flag ordinary commands that merely mention the words', () => {
    expect(riskyPasteCommand('echo "remove the old build"')).toBeNull()
    expect(riskyPasteCommand('git push origin main')).toBeNull()
    expect(riskyPasteCommand('npm run format')).toBeNull()
  })
})
