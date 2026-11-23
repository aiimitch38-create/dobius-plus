// Claude Code conversations: ~/.claude/projects/<folder>/<session>.jsonl.
// Only what the user and Claude wrote to each other; tool calls, tool output,
// thinking, hidden meta turns and subagent sidechains are left out.
import { basename } from 'node:path'
import { RecentSections, titleFrom } from '../library-chunk'
import { addClaudeSignals, emptySignals } from '../library-classify'
import type { LibraryDocument, LibraryIngester } from '../library-types'
import { projectForPath } from './fs-walk'
import type { FileStat } from './jsonl-lines'
import { asText, jsonlFiles, safeJsonLines, timeOf } from './jsonl-lines'

const NOISE_TAG = /^<(?:command-|local-command-|bash-|task-notification|user-prompt-submit-hook)/

/** What a person typed, without harness wrappers; empty when it was only harness text. */
export function cleanUserText(text: string): string {
  const stripped = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?(?:teammate-message|cross-session-message|pasted_content)[^>]*>/g, '')
    .trim()
  return NOISE_TAG.test(stripped) ? '' : stripped
}

function messageText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .flatMap((item) =>
      item && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
        ? [asText((item as { text?: unknown }).text)]
        : []
    )
    .join('\n\n')
}

// Why: a cheap test before JSON.parse; tool output lines carry no "text" block.
function keepLine(line: string): boolean {
  if (line.includes('"ai-title"') || line.includes('"custom-title"')) {
    return true
  }
  if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) {
    return false
  }
  return line.includes('"type":"text"') || line.includes('"content":"')
}

export async function readClaudeConversation(
  file: FileStat,
  projectsRoot: string
): Promise<LibraryDocument | null> {
  const recent = new RecentSections()
  const mtimeMs = file.mtimeMs
  let cwd = ''
  let aiTitle = ''
  let firstUser = ''
  const signals = emptySignals()
  for await (const record of safeJsonLines(file, keepLine, (line) => addClaudeSignals(line, signals))) {
    const type = record.type
    if (type === 'ai-title' || type === 'custom-title') {
      aiTitle = asText(record.aiTitle ?? record.customTitle) || aiTitle
      continue
    }
    if ((type !== 'user' && type !== 'assistant') || record.isMeta || record.isSidechain) {
      continue
    }
    if (record.isCompactSummary) {
      continue
    }
    cwd ||= asText(record.cwd)
    const message = record.message as { content?: unknown } | undefined
    const raw = messageText(message?.content)
    const text = type === 'user' ? cleanUserText(raw) : raw.trim()
    if (!text) {
      continue
    }
    firstUser ||= type === 'user' ? text : ''
    recent.push({
      text: `${type === 'user' ? 'User' : 'Claude'}: ${text}`,
      at: timeOf(record.timestamp, mtimeMs)
    })
  }
  const sections = recent.sections
  if (sections.length === 0) {
    return null
  }
  return {
    project: cwd ? projectForPath(cwd, projectsRoot) : null,
    title: aiTitle || titleFrom(firstUser, `Claude session ${basename(file.path, '.jsonl')}`),
    sections,
    signals
  }
}

export function claudeConversationsIngester(
  claudeProjectsDir: string,
  projectsRoot: string
): LibraryIngester {
  return {
    source: 'claude',
    list: async () =>
      (await jsonlFiles(claudeProjectsDir, 2)).map((file) => ({
        key: `claude:${file.path}`,
        source: 'claude' as const,
        path: file.path,
        mtimeMs: file.mtimeMs,
        size: file.size,
        load: () => readClaudeConversation(file, projectsRoot)
      }))
  }
}
