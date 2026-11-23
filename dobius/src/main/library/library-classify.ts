// What kind of conversation a transcript was, by cheap local rules (no model):
// finished work, open work, or a chat. Decides what is compacted and what is
// dropped first when the library is over its cap. Notes are 'reference'.
import type { LibraryDocument, LibrarySource } from './library-types'

export const DOC_CLASSES = ['work-done', 'work-open', 'chat', 'reference'] as const
export type DocClass = (typeof DOC_CLASSES)[number]

/** Counted from raw transcript lines while reading; tool lines are never stored. */
export type TranscriptSignals = { toolCalls: number; edits: number; gitWrites: number }

export const emptySignals = (): TranscriptSignals => ({ toolCalls: 0, edits: 0, gitWrites: 0 })

const GIT_WRITE = /\bgit\b[^\n"]{0,120}?\b(?:commit|merge|push)\b/
const CLAUDE_EDIT = /"name":"(?:Edit|Write|MultiEdit|NotebookEdit)"/
const CLAUDE_TOOL = /"type":"tool_use"/g

/** Signals in one raw Claude transcript line (an assistant line with tool_use blocks). */
export function addClaudeSignals(line: string, signals: TranscriptSignals): void {
  if (!line.includes('"type":"assistant"') || !line.includes('"tool_use"')) {
    return
  }
  signals.toolCalls += line.match(CLAUDE_TOOL)?.length ?? 0
  signals.edits += CLAUDE_EDIT.test(line) ? 1 : 0
  signals.gitWrites += GIT_WRITE.test(line) ? 1 : 0
}

/** Signals in one raw Codex rollout line (function or custom tool calls). */
export function addCodexSignals(line: string, signals: TranscriptSignals): void {
  if (!/"type":\s*"(?:function_call|custom_tool_call|local_shell_call)"/.test(line)) {
    return
  }
  signals.toolCalls += 1
  signals.edits += /apply_patch|\*\*\* Begin Patch/.test(line) ? 1 : 0
  signals.gitWrites += GIT_WRITE.test(line) ? 1 : 0
}

const TASK_ASK =
  /^(?:please\s+|can you\s+|could you\s+)?(?:build|fix|add|make|create|implement|update|change|write|refactor|remove|delete|install|ship|deploy|set up|setup|wire|merge|migrate|rename|move)\b/i
const FINISHED = /\b(?:done|merged|shipped|committed|fixed|installed|complete|completed)\b/i
export const REF_PATTERN =
  /\b(?:PR|pull request)\s*#?\d+\b|github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|\bcommit(?:ted)?\b[^\n]{0,40}?\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,12}\b/gi

const SPEAKER = /^(?:User|Carson|Claude|Codex|ADAM):\s*/
const isUser = (text: string): boolean => /^(?:User|Carson):/.test(text)

/**
 * 'work-done': an objective and a sign it was finished (a git commit, merge
 * or push; a PR or commit ref; or a final answer saying done, merged,
 * shipped, committed, fixed, installed or complete). 'work-open': an
 * objective (file edits, real tool work, or a task request) and no such sign.
 * 'chat': the rest, mostly questions and answers.
 */
export function classifyDocument(source: LibrarySource, doc: LibraryDocument): DocClass {
  if (source === 'project' || source === 'obsidian') {
    return 'reference'
  }
  const signals = doc.signals ?? emptySignals()
  const firstAsk = doc.sections.find((section) => isUser(section.text))?.text.replace(SPEAKER, '') ?? ''
  const finalAnswer =
    doc.sections.findLast((section) => !isUser(section.text))?.text.replace(SPEAKER, '') ?? ''
  const objective =
    signals.edits > 0 || signals.gitWrites > 0 || signals.toolCalls >= 5 || TASK_ASK.test(firstAsk.trim())
  if (!objective) {
    return 'chat'
  }
  const refs = doc.sections.some((section) => new RegExp(REF_PATTERN.source, 'i').test(section.text))
  const finished = signals.gitWrites > 0 || refs || FINISHED.test(finalAnswer.slice(-1500))
  return finished ? 'work-done' : 'work-open'
}
