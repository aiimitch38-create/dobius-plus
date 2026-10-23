// Link graph for the Markdown studio: which repo docs point at which, from
// [[wiki-links]] (same resolver as the editor) and relative `](./x.md)` links.
// Pure: callers supply the documents and their contents.
import type { MarkdownDocument } from '../../../../../shared/types'
import {
  createMarkdownDocumentIndex,
  resolveMarkdownDocLink,
  splitMarkdownDocLinkText
} from '@/components/editor/markdown-doc-links'

export type MarkdownLinkEdge = { from: string; to: string }
export type MarkdownLinkGraphNode = {
  relativePath: string
  name: string
  degree: number
  x: number
  y: number
}
export type MarkdownLinkGraph = {
  nodes: MarkdownLinkGraphNode[]
  edges: MarkdownLinkEdge[]
  /** Docs with no links in or out; left off the drawing to keep it readable. */
  unlinkedCount: number
  size: number
}

const RELATIVE_LINK =
  /\]\(\s*<?([^)\s>]+\.(?:md|markdown|mdx))(?:#[^)\s>]*)?>?(?:\s+"[^"]*")?\s*\)/gi
const GRAPH_PADDING = 90
const NODE_SPACING = 56
const MIN_RADIUS = 120

function normalizeRelativePath(path: string): string | null {
  const out: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      if (out.length === 0) {
        return null
      }
      out.pop()
    } else {
      out.push(part)
    }
  }
  return out.join('/')
}

function resolveRelativeLink(fromRelativePath: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null
  }
  let decoded = href
  try {
    decoded = decodeURIComponent(href)
  } catch {
    // Malformed escapes: match the raw href instead.
  }
  if (decoded.startsWith('/')) {
    return normalizeRelativePath(decoded)
  }
  const dir = fromRelativePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
  return normalizeRelativePath(dir ? `${dir}/${decoded}` : decoded)
}

/** Directed, de-duplicated links between the given docs (self-links dropped). */
export function collectMarkdownLinks(
  documents: readonly MarkdownDocument[],
  contentByPath: ReadonlyMap<string, string>
): MarkdownLinkEdge[] {
  const index = createMarkdownDocumentIndex([...documents])
  const byPath = new Map(
    documents.map((d) => [normalizeRelativePath(d.relativePath)?.toLowerCase() ?? '', d])
  )
  const edges: MarkdownLinkEdge[] = []
  const seen = new Set<string>()
  const add = (from: MarkdownDocument, to: MarkdownDocument | undefined): void => {
    if (!to || to.relativePath === from.relativePath) {
      return
    }
    const key = `${from.relativePath}\u0001${to.relativePath}`
    if (!seen.has(key)) {
      seen.add(key)
      edges.push({ from: from.relativePath, to: to.relativePath })
    }
  }
  for (const doc of documents) {
    const content = contentByPath.get(doc.relativePath)
    if (!content) {
      continue
    }
    for (const part of splitMarkdownDocLinkText(content)) {
      if (part.type === 'docLink') {
        const resolution = resolveMarkdownDocLink(part.target, index)
        add(doc, resolution.status === 'resolved' ? resolution.document : undefined)
      }
    }
    for (const match of content.matchAll(RELATIVE_LINK)) {
      const target = resolveRelativeLink(doc.relativePath, match[1])
      add(doc, target ? byPath.get(target.toLowerCase()) : undefined)
    }
  }
  return edges
}

/** Linked docs on a circle, most-connected first so hubs sit at the top. */
export function layoutMarkdownLinkGraph(
  documents: readonly MarkdownDocument[],
  edges: readonly MarkdownLinkEdge[]
): MarkdownLinkGraph {
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const linked = documents
    .filter((d) => degree.has(d.relativePath))
    .sort(
      (a, b) =>
        degree.get(b.relativePath)! - degree.get(a.relativePath)! ||
        a.relativePath.localeCompare(b.relativePath)
    )
  // ponytail: a circle reads fine up to ~100 linked docs; force layout if repos outgrow it.
  const radius = Math.max(MIN_RADIUS, (linked.length * NODE_SPACING) / (2 * Math.PI))
  const center = radius + GRAPH_PADDING
  const nodes = linked.map((doc, i) => {
    const angle = (i / linked.length) * 2 * Math.PI - Math.PI / 2
    return {
      relativePath: doc.relativePath,
      name: doc.name,
      degree: degree.get(doc.relativePath)!,
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle)
    }
  })
  return {
    nodes,
    edges: [...edges],
    unlinkedCount: documents.length - linked.length,
    size: center * 2
  }
}
