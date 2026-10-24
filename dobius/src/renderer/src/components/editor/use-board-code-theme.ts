import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { BeforeMount } from '@monaco-editor/react'
import { monaco } from '@/lib/monaco-setup'

const BOARD_CODE_THEME = 'dobius-board-code'
const boardEditors = new Set<symbol>()

export function useBoardCodeTheme(
  container: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  appIsDark: boolean
): BeforeMount {
  const appTheme = useRef(appIsDark)
  appTheme.current = appIsDark
  const beforeMount = useCallback<BeforeMount>(
    (editor) => {
      if (!enabled || !container.current) {
        return
      }
      const tokens = getComputedStyle(container.current)
      const background = tokens.getPropertyValue('--board-code-editor-bg').trim()
      const foreground = tokens.getPropertyValue('--board-code-editor-text').trim()
      const gutter = tokens.getPropertyValue('--board-code-editor-gutter').trim()
      editor.editor.defineTheme(BOARD_CODE_THEME, {
        base: 'vs-dark',
        inherit: true,
        rules: [
          {
            token: 'key.ini',
            foreground: tokens.getPropertyValue('--board-code-editor-key').trim().replace('#', '')
          },
          {
            token: 'comment.ini',
            foreground: tokens
              .getPropertyValue('--board-code-editor-comment')
              .trim()
              .replace('#', '')
          },
          {
            token: 'number.ini',
            foreground: tokens
              .getPropertyValue('--board-code-editor-number')
              .trim()
              .replace('#', '')
          }
        ],
        colors: {
          'editor.background': background,
          'editor.foreground': foreground,
          'editorGutter.background': background,
          'editorLineNumber.foreground': gutter,
          'editor.lineHighlightBackground': background
        }
      })
    },
    [container, enabled]
  )

  useEffect(() => {
    if (!enabled) {
      return
    }
    const editorInstance = Symbol()
    boardEditors.add(editorInstance)
    // Why: Monaco themes are global. Restore Classic's theme when the studio
    // closes so its dark editor does not recolor an already mounted editor.
    return () => {
      boardEditors.delete(editorInstance)
      // File switches replace editor instances in the same React commit.
      queueMicrotask(() => {
        if (boardEditors.size === 0) {
          monaco.editor.setTheme(appTheme.current ? 'vs-dark' : 'vs')
        }
      })
    }
  }, [enabled])
  return beforeMount
}

export const boardCodeTheme = BOARD_CODE_THEME
