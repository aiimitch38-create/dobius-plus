import { createElement } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getConnectionId } from '@/lib/connection-context'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import {
  buildDocumentPdfHtml,
  documentExportBaseName,
  escapeHtml,
  type DocumentPdfPageSize
} from './document-generation-export'
import type { RepoDocument } from './use-repo-documents'

export type DocumentExportFormat =
  | { kind: 'pdf'; pageSize: DocumentPdfPageSize }
  | { kind: 'markdown' }

export function isExportableDocument(doc: RepoDocument): boolean {
  return /\.(md|markdown|txt)$/i.test(doc.relativePath)
}

async function readDocument(worktreeId: string, doc: RepoDocument): Promise<string> {
  const result = await readRuntimeFileContent({
    settings: getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), worktreeId),
    filePath: doc.filePath,
    relativePath: doc.relativePath,
    worktreeId,
    connectionId: getConnectionId(worktreeId) ?? undefined
  })
  if (result.isBinary) {
    throw new Error(translate('board.studio.docs.binary', 'This file cannot be shown as text.'))
  }
  return result.content
}

// Why: loaded on demand so the static renderer is only paid for on export.
async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const [{ renderToStaticMarkup }, { default: ReactMarkdown }, { default: remarkGfm }] =
    await Promise.all([import('react-dom/server'), import('react-markdown'), import('remark-gfm')])
  // Why: no rehype-raw, so raw HTML in the markdown is escaped, never injected.
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown)
  )
}

/** Exports a studio document as a paginated PDF or a Markdown copy via the native save dialog. */
export async function exportRepoDocument(args: {
  worktreeId: string
  doc: RepoDocument
  format: DocumentExportFormat
}): Promise<void> {
  const { worktreeId, doc, format } = args
  const toastId = toast.loading(translate('board.studio.docs.exporting', 'Exporting…'))
  try {
    const content = await readDocument(worktreeId, doc)
    const baseName = documentExportBaseName(doc.name)
    if (format.kind === 'markdown') {
      const result = await window.api.fs.saveDownloadedFile({
        suggestedName: `${baseName}.md`,
        content,
        encoding: 'utf8'
      })
      if (result.canceled) {
        toast.dismiss(toastId)
        return
      }
      toast.success(
        translate('board.studio.docs.exported', 'Exported to {{path}}', {
          path: result.destinationPath
        }),
        { id: toastId }
      )
      return
    }

    const isMarkdown = /\.(md|markdown)$/i.test(doc.relativePath)
    const bodyHtml = isMarkdown
      ? await renderMarkdownToHtml(content)
      : `<pre>${escapeHtml(content)}</pre>`
    const html = buildDocumentPdfHtml({
      title: baseName,
      meta: [doc.relativePath, new Date().toLocaleDateString()],
      bodyHtml,
      tocTitle: translate('board.studio.docs.tocTitle', 'Contents'),
      lang: typeof navigator === 'undefined' ? 'en' : navigator.language
    })
    const result = await window.api.export.htmlToPdf({
      html,
      title: baseName,
      pageSize: format.pageSize,
      pageNumbers: true
    })
    if (result.success) {
      toast.success(
        translate('board.studio.docs.exported', 'Exported to {{path}}', { path: result.filePath }),
        { id: toastId }
      )
      return
    }
    if (result.cancelled) {
      toast.dismiss(toastId)
      return
    }
    toast.error(
      result.error ??
        translate('board.studio.docs.exportFailed', 'Could not export this document.'),
      { id: toastId }
    )
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : translate('board.studio.docs.exportFailed', 'Could not export this document.'),
      { id: toastId }
    )
  }
}
