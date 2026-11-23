// Codex conversations: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl. Only the
// user and assistant messages; developer instructions, reasoning, tool calls
// and tool output are left out, and so are the context blocks Codex injects
// as user messages (<environment_context>, AGENTS.md instructions).
import { basename } from 'node:path'
import { titleFrom } from '../library-chunk'
import type { LibraryDocument, LibraryIngester, LibrarySection } from '../library-types'
import { projectForPath } from './fs-walk'
import { asText, jsonLines, jsonlFiles, timeOf } from './jsonl-lines'

function isInjectedContext(text: string): boolean {
  return /^<[a-z_-]+[\s>]/i.test(text) || text.startsWith('# AGENTS.md instructions')
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .flatMap((item) => {
      const type = (item as { type?: unknown } | null)?.type
      return type === 'input_text' || type === 'output_text'
        ? [asText((item as { text?: unknown }).text)]
        : []
    })
    .join('\n\n')
    .trim()
}

function keepLine(line: string): boolean {
  return line.includes('"session_meta"') || (line.includes('"message"') && line.includes('_text"'))
}

export async function readCodexConversation(
  file: string,
  mtimeMs: number,
  projectsRoot: string
): Promise<LibraryDocument | null> {
  const sections: LibrarySection[] = []
  let cwd = ''
  let firstUser = ''
  for await (const record of jsonLines(file, keepLine)) {
    const payload = (record.payload ?? {}) as Record<string, unknown>
    if (record.type === 'session_meta') {
      cwd ||= asText(payload.cwd)
      continue
    }
    if (record.type !== 'response_item' || payload.type !== 'message') {
      continue
    }
    const role = payload.role
    if (role !== 'user' && role !== 'assistant') {
      continue
    }
    const text = contentText(payload.content)
    if (!text || (role === 'user' && isInjectedContext(text))) {
      continue
    }
    firstUser ||= role === 'user' ? text : ''
    sections.push({
      text: `${role === 'user' ? 'User' : 'Codex'}: ${text}`,
      at: timeOf(record.timestamp, mtimeMs)
    })
  }
  if (sections.length === 0) {
    return null
  }
  return {
    project: cwd ? projectForPath(cwd, projectsRoot) : null,
    title: titleFrom(firstUser, `Codex session ${basename(file, '.jsonl')}`),
    sections
  }
}

export function codexConversationsIngester(
  codexSessionsDir: string,
  projectsRoot: string
): LibraryIngester {
  return {
    source: 'codex',
    list: async () =>
      (await jsonlFiles(codexSessionsDir, 4)).map((file) => ({
        key: `codex:${file.path}`,
        source: 'codex' as const,
        path: file.path,
        mtimeMs: file.mtimeMs,
        size: file.size,
        load: () => readCodexConversation(file.path, file.mtimeMs, projectsRoot)
      }))
  }
}
