import { detectLanguage } from '@/lib/language-detect'

const MARKDOWN_EXT = /\.(md|markdown|mdx|mdown)$/i
// Why: a card renders the whole file at once; past this, highlighting stalls the canvas.
export const CODE_CARD_MAX_CHARS = 200_000

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT.test(path)
}

/**
 * Wraps source code in a fenced block so the app's markdown renderer
 * highlights it. The fence is longer than any backtick run in the file, so
 * the code can never close it early.
 */
export function codeAsMarkdown(
  path: string,
  content: string
): { markdown: string; truncated: boolean } {
  const truncated = content.length > CODE_CARD_MAX_CHARS
  const body = truncated ? content.slice(0, CODE_CARD_MAX_CHARS) : content
  const longestRun = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  const lang = detectLanguage(path)
  const info = lang && lang !== 'plaintext' ? lang : ''
  return {
    markdown: `${fence}${info}\n${body}${body.endsWith('\n') ? '' : '\n'}${fence}\n`,
    truncated
  }
}
