import { EXPORT_CSS } from '@/components/editor/export-css'

// Pure builders for the Documents studio's PDF export: heading anchors, the
// table of contents, and the standalone print document (title page + TOC +
// body). The main process prints it with page numbers in the footer.

export type DocumentHeading = { level: number; text: string; id: string }

export type DocumentPdfPageSize = 'Letter' | 'A4'

const HEADING_RE = /<h([1-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

export function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
  return slug || 'section'
}

/**
 * Gives every heading in a rendered HTML fragment a unique id and returns the
 * headings in document order, so TOC links resolve inside the printed PDF.
 * Existing attributes on the heading are dropped (the renderer emits none).
 */
export function anchorHeadings(html: string): { html: string; headings: DocumentHeading[] } {
  const headings: DocumentHeading[] = []
  const used = new Map<string, number>()
  const out = html.replace(HEADING_RE, (_match, level: string, _attrs, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim()
    const base = `h-${slugifyHeading(text)}`
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    const id = seen === 0 ? base : `${base}-${seen + 1}`
    headings.push({ level: Number(level), text, id })
    return `<h${level} id="${id}">${inner}</h${level}>`
  })
  return { html: out, headings }
}

/** Nested-by-indent TOC list; headings deeper than maxLevel are left out. */
export function buildTocHtml(headings: readonly DocumentHeading[], maxLevel = 3): string {
  const shown = headings.filter((h) => h.level <= maxLevel && h.text)
  if (shown.length === 0) {
    return ''
  }
  const top = Math.min(...shown.map((h) => h.level))
  const items = shown
    .map(
      (h) => `<li class="toc-l${h.level - top}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`
    )
    .join('\n')
  return `<ol class="toc-list">\n${items}\n</ol>`
}

/** Strips the extension and characters no filesystem accepts. */
export function documentExportBaseName(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return (
    base
      .replace(/[/\\:*?"<>|]/g, '_')
      .trim()
      .slice(0, 100) || 'document'
  )
}

const PDF_LAYOUT_CSS = `
.doc-title-page { display: flex; flex-direction: column; justify-content: center; min-height: 8in; page-break-after: always; break-after: page; }
.doc-title-page h1.doc-title { font-size: 34px; line-height: 1.2; margin: 0 0 16px; border: 0; }
.doc-title-page .doc-meta { opacity: 0.7; font-size: 13px; margin: 2px 0; }
.doc-toc { page-break-after: always; break-after: page; }
.doc-toc h2 { font-size: 20px; margin: 0 0 12px; }
.toc-list { list-style: none; padding: 0; margin: 0; }
.toc-list li { margin: 4px 0; }
.toc-list a { color: inherit; text-decoration: none; }
.toc-l1 { padding-left: 18px; }
.toc-l2 { padding-left: 36px; font-size: 13px; }
.toc-l3, .toc-l4, .toc-l5 { padding-left: 54px; font-size: 12px; }
h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
`

export type DocumentPdfArgs = {
  title: string
  /** Lines under the title, e.g. the repo path and the export date. */
  meta: readonly string[]
  /** Rendered markdown body (trusted renderer output, no raw HTML passthrough). */
  bodyHtml: string
  tocTitle: string
  lang?: string
}

/** Standalone print document: title page, table of contents, then the body. */
export function buildDocumentPdfHtml(args: DocumentPdfArgs): string {
  const { html, headings } = anchorHeadings(args.bodyHtml)
  const toc = buildTocHtml(headings)
  const meta = args.meta.map((line) => `<p class="doc-meta">${escapeHtml(line)}</p>`).join('\n')
  const title = escapeHtml(args.title || 'Untitled')
  // Why (CSP): same policy as the editor's markdown export, scripts never run.
  return `<!DOCTYPE html>
<html lang="${escapeHtml(args.lang ?? 'en')}">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http: file:; style-src 'unsafe-inline'; font-src data: https:;" />
<title>${title}</title>
<style>${EXPORT_CSS}${PDF_LAYOUT_CSS}</style>
</head>
<body>
<section class="doc-title-page">
<h1 class="doc-title">${title}</h1>
${meta}
</section>
${toc ? `<nav class="doc-toc">\n<h2>${escapeHtml(args.tocTitle)}</h2>\n${toc}\n</nav>` : ''}
<div class="dobius-export-root">
${html}
</div>
</body>
</html>`
}
