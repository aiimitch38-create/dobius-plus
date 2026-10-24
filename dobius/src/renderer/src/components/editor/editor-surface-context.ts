import { createContext, useContext } from 'react'
import type { FileContent } from './editor-panel-content-types'

// Why: Board's Code studio has its own chrome, while the editor keeps owning
// file loading, drafts, autosave, undo, and remote-runtime behavior.
export const EditorSurfaceContext = createContext<{
  kind: 'board-code'
  onContentReady: (fileId: string, content: FileContent | undefined) => void
} | null>(null)

export const useEditorSurface = (): React.ContextType<typeof EditorSurfaceContext> =>
  useContext(EditorSurfaceContext)
