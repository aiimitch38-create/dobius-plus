// Writing requests the Docs studio sends to a console agent. Pure: no DOM, no store.
export type DocumentTemplateId = 'overview' | 'onboarding' | 'architecture' | 'custom'

export const DOCUMENT_TEMPLATE_IDS: readonly DocumentTemplateId[] = [
  'overview',
  'onboarding',
  'architecture',
  'custom'
]

const TEMPLATE_FILES: Record<Exclude<DocumentTemplateId, 'custom'>, string> = {
  overview: 'docs/OVERVIEW.md',
  onboarding: 'docs/ONBOARDING.md',
  architecture: 'docs/ARCHITECTURE.md'
}

const TEMPLATE_BRIEFS: Record<Exclude<DocumentTemplateId, 'custom'>, string> = {
  overview:
    'a project overview: what this repository is, who it is for, the main features, and how to run it',
  onboarding:
    'an onboarding guide for a new developer: setup steps, key commands, where things live, and the first changes to try',
  architecture:
    'an architecture document: the main modules and how they talk to each other, data flow, and the important design decisions'
}

/** Repo-relative file the agent is asked to write, or null when the custom ask names none. */
export function documentTemplateFile(template: DocumentTemplateId): string | null {
  return template === 'custom' ? null : TEMPLATE_FILES[template]
}

/** The notice line every generated document starts with (the text is localized by the caller). */
export function documentNoticeInstruction(notice: string): string {
  const text = notice.replace(/\s+/g, ' ').trim()
  return text
    ? ` Start the document with this notice as a markdown blockquote, word for word: "> **Note:** ${text}"`
    : ''
}

/**
 * The prompt pushed to the agent, or null when a custom request is empty.
 * Why: one line so the terminal paste submits as a single message.
 */
export function buildDocumentRequest(
  template: DocumentTemplateId,
  customAsk = '',
  notice = ''
): string | null {
  const start = documentNoticeInstruction(notice)
  if (template === 'custom') {
    const ask = customAsk.replace(/\s+/g, ' ').trim()
    return ask
      ? `Write a markdown document for this repository: ${ask}. Read the code first, keep it factual, and tell me the file path when done.${start}`
      : null
  }
  return `Write ${TEMPLATE_BRIEFS[template]}. Read the code first, keep it factual, and save it as ${TEMPLATE_FILES[template]} (create the folder if needed). Tell me the file path when done.${start}`
}
