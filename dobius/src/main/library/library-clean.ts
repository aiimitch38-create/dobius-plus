import { chunkSections } from './library-chunk'
import { scrubForIndex, scrubLabel } from './library-secrets'
import type { LibraryDocument, LibrarySection } from './library-types'

export type CleanDocument = {
  title: string
  project: string | null
  chunks: LibrarySection[]
  dropped: number
}

/**
 * A document fit to store. Why each section is scrubbed before chunking: a
 * chunk boundary can fall between "password:" and its value, and the value
 * alone looks harmless. Chunks are checked again after the split, and the
 * title and project, which are stored and indexed too, are scrubbed like
 * snippets.
 */
export function cleanDocument(doc: LibraryDocument): CleanDocument {
  let dropped = 0
  const sections: LibrarySection[] = []
  for (const section of doc.sections) {
    const text = scrubForIndex(section.text)
    if (text === null) {
      dropped += 1
    } else {
      sections.push({ text, at: section.at })
    }
  }
  const chunks: LibrarySection[] = []
  for (const chunk of chunkSections(sections)) {
    const text = scrubForIndex(chunk.text)
    if (text === null) {
      dropped += 1
    } else {
      chunks.push({ text, at: chunk.at })
    }
  }
  return {
    title: scrubLabel(doc.title, 160, 'Untitled'),
    project: doc.project ? scrubLabel(doc.project, 80, 'Unnamed project') : null,
    chunks,
    dropped
  }
}
