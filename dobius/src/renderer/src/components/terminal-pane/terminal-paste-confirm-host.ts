import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useAppStore } from '@/store'
import {
  pasteAsOneLine,
  terminalPasteConfirmReason,
  type TerminalPasteConfirmReason
} from './terminal-paste-confirm'
import type { TerminalPasteSource, TerminalPasteTextOptions } from './terminal-paste-model'

// Shows the paste confirmation from any terminal (Classic tab or Board console
// card) without threading a dialog through every pane: one dialog, mounted on
// first use in its own root, fed by a tiny request queue.

export type TerminalPasteChoice = 'paste' | 'one-line' | 'cancel'

export type TerminalPasteConfirmRequest = TerminalPasteConfirmReason & {
  id: number
  targetName: string
  resolve: (choice: TerminalPasteChoice, dontAskAgain: boolean) => void
}

let nextId = 1
let queue: TerminalPasteConfirmRequest[] = []
const listeners = new Set<() => void>()
let mounting: Promise<void> | null = null

export function subscribeTerminalPasteConfirm(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function activeTerminalPasteConfirm(): TerminalPasteConfirmRequest | null {
  return queue[0] ?? null
}

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function mountDialog(): Promise<void> {
  if (!mounting) {
    mounting = import('./TerminalPasteConfirmDialog')
      .then(({ TerminalPasteConfirmDialog }) => {
        const host = document.createElement('div')
        host.dataset.terminalPasteConfirmHost = ''
        document.body.appendChild(host)
        createRoot(host).render(createElement(TerminalPasteConfirmDialog))
      })
      .catch((error: unknown) => {
        // Why: a failed load must be retried on the next paste, not leave
        // every later request waiting on a dialog that never appears.
        mounting = null
        throw error
      })
  }
  return mounting
}

function requestChoice(
  reason: TerminalPasteConfirmReason,
  targetName: string
): Promise<{ choice: TerminalPasteChoice; dontAskAgain: boolean }> {
  return new Promise((resolve) => {
    const id = nextId++
    queue = [
      ...queue,
      {
        ...reason,
        id,
        targetName,
        resolve: (choice, dontAskAgain) => {
          queue = queue.filter((r) => r.id !== id)
          emit()
          resolve({ choice, dontAskAgain })
        }
      }
    ]
    emit()
    void mountDialog().catch((error: unknown) => {
      console.error('[terminal-paste] confirmation dialog failed to load', error)
      queue = queue.filter((r) => r.id !== id)
      emit()
      resolve({ choice: 'cancel', dontAskAgain: false })
    })
  })
}

/** Console card title if the tab is on a Board, else the tab's own label. */
function terminalName(tabId: string): string {
  const state = useAppStore.getState()
  for (const board of Object.values(state.boardsByWorktree ?? {})) {
    const card = board.cards.find((c) => c.kind === 'console' && c.tabId === tabId)
    if (card) {
      return card.title
    }
  }
  const tab = Object.values(state.tabsByWorktree ?? {})
    .flat()
    .find((t) => t.id === tabId)
  return tab ? tab.customTitle || tab.title : ''
}

/**
 * Runs before a user paste reaches the terminal. Resolves with the text to
 * paste (possibly joined into one line), or null when the user cancelled.
 */
export async function confirmTerminalPaste(input: {
  text: string
  source: TerminalPasteSource
  options?: TerminalPasteTextOptions
  bracketedPasteMode: boolean
  tabId: string
  /** Refocused after the dialog so the paste still targets the same terminal. */
  restoreFocus: Element | null
}): Promise<string | null> {
  const reason = terminalPasteConfirmReason({
    text: input.text,
    source: input.source,
    bracketedPasteMode: input.bracketedPasteMode,
    enabled: useAppStore.getState().settings?.terminalPasteConfirm,
    options: input.options
  })
  if (!reason) {
    return input.text
  }
  const { choice, dontAskAgain } = await requestChoice(reason, terminalName(input.tabId))
  if (dontAskAgain && choice !== 'cancel') {
    void useAppStore.getState().updateSettings({ terminalPasteConfirm: false })
  }
  if (input.restoreFocus instanceof HTMLElement) {
    input.restoreFocus.focus()
  }
  return choice === 'cancel'
    ? null
    : choice === 'one-line'
      ? pasteAsOneLine(input.text)
      : input.text
}
