import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { PrintToPDFOptions } from 'electron'
import { buildPrintToPdfOptions } from '../browser/cdp-print-to-pdf'
import { ExportTimeoutError, htmlToPdf } from '../lib/html-to-pdf'

export type ExportPdfPageSize = 'Letter' | 'A4'

export type ExportHtmlToPdfArgs = {
  html: string
  title: string
  /** Paper size; omitted keeps the historical A4 default. */
  pageSize?: ExportPdfPageSize
  /** Print "n / total" in the page footer. */
  pageNumbers?: boolean
}

// Inches, matching CDP Page.printToPDF paperWidth/paperHeight.
const PAPER_INCHES: Record<ExportPdfPageSize, { paperWidth: number; paperHeight: number }> = {
  Letter: { paperWidth: 8.5, paperHeight: 11 },
  A4: { paperWidth: 8.27, paperHeight: 11.69 }
}

// Why: Chromium renders the footer as its own tiny document with a 0px default
// font, so the size must be explicit; pageNumber/totalPages are filled in by
// Chromium itself (no script runs in the template).
const PAGE_NUMBER_FOOTER =
  '<div style="width:100%;font-size:9px;color:#6b7280;text-align:center;font-family:-apple-system,Helvetica,Arial,sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'

/** Translates the export args into printToPDF overrides through the shared CDP option sanitizer. */
export function buildExportPrintOverrides(
  args: Pick<ExportHtmlToPdfArgs, 'pageSize' | 'pageNumbers'>
): PrintToPDFOptions {
  const paper =
    args.pageSize === 'Letter' || args.pageSize === 'A4' ? PAPER_INCHES[args.pageSize] : null
  if (!paper && !args.pageNumbers) {
    return {}
  }
  return buildPrintToPdfOptions({
    ...paper,
    ...(args.pageNumbers
      ? {
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: PAGE_NUMBER_FOOTER,
          marginTop: 0.75,
          marginBottom: 0.8,
          marginLeft: 0.75,
          marginRight: 0.75
        }
      : {})
  })
}

export type ExportHtmlToPdfResult =
  | { success: true; filePath: string }
  | { success: false; cancelled?: boolean; error?: string }

export function registerExportHandlers(): void {
  ipcMain.removeHandler('export:html-to-pdf')
  ipcMain.handle(
    'export:html-to-pdf',
    async (event, args: ExportHtmlToPdfArgs): Promise<ExportHtmlToPdfResult> => {
      const { html, title } = args
      if (!html.trim()) {
        return { success: false, error: 'No content to export' }
      }

      try {
        const pdfBuffer = await htmlToPdf(html, buildExportPrintOverrides(args))

        // Why: sanitize to keep the suggested filename legal on every platform.
        // Windows forbids /\:*?"<>| in filenames; truncate to keep the OS save
        // dialog stable when titles are pathologically long.
        const sanitizedTitle = title.replace(/[/\\:*?"<>|]/g, '_').slice(0, 100) || 'export'
        const defaultFilename = `${sanitizedTitle}.pdf`

        const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const dialogOptions = {
          defaultPath: defaultFilename,
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        }
        const { canceled, filePath } = parent
          ? await dialog.showSaveDialog(parent, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions)

        if (canceled || !filePath) {
          return { success: false, cancelled: true }
        }

        await writeFile(filePath, pdfBuffer)
        return { success: true, filePath }
      } catch (error) {
        if (error instanceof ExportTimeoutError) {
          return { success: false, error: 'Export timed out' }
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to export PDF'
        }
      }
    }
  )
}
