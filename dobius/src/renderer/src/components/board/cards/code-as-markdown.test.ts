import { describe, expect, it } from 'vitest'
import { CODE_CARD_MAX_CHARS, codeAsMarkdown, isMarkdownPath } from './code-as-markdown'

describe('isMarkdownPath', () => {
  it('detects markdown extensions only', () => {
    expect(isMarkdownPath('/a/README.md')).toBe(true)
    expect(isMarkdownPath('notes.MDX')).toBe(true)
    expect(isMarkdownPath('src/app.ts')).toBe(false)
    expect(isMarkdownPath('md')).toBe(false)
  })
})

describe('codeAsMarkdown', () => {
  it('fences code with the detected language', () => {
    const { markdown } = codeAsMarkdown('src/app.ts', 'const a = 1')
    expect(markdown.startsWith('```typescript\n')).toBe(true)
    expect(markdown.endsWith('\n```\n')).toBe(true)
  })
  it('uses a fence longer than any backtick run so the code cannot escape', () => {
    const { markdown } = codeAsMarkdown('x.js', 'const s = `a` + "```" + "````"')
    expect(markdown.startsWith('`````')).toBe(true)
    expect(markdown.split('\n').at(-2)).toBe('`````')
  })
  it('truncates very large files', () => {
    const { truncated, markdown } = codeAsMarkdown('big.txt', 'x'.repeat(CODE_CARD_MAX_CHARS + 10))
    expect(truncated).toBe(true)
    expect(markdown.length).toBeLessThan(CODE_CARD_MAX_CHARS + 50)
  })
})
