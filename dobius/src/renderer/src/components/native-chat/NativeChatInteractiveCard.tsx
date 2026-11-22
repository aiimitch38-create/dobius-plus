import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store'
import { parseInteractivePrompt, type InteractivePromptCard } from './native-chat-interactive-prompt'
import { nativeChatCardDismissKey } from './native-chat-dismiss-key'
import { NativeChatQuestionCard } from './NativeChatQuestionCard'
import { NativeChatApprovalCard } from './NativeChatApprovalCard'
import type { NativeChatInteractiveSend } from './use-native-chat-interactive-send'

/**
 * Render the live interactive card for the pane while the agent's
 * `interactivePrompt` is present: a question wizard (precedence) or a tool
 * approval. Cleared by the host once the agent moves on, so it disappears
 * automatically. Sends through the composer's verified runtime path (R8/R6):
 * answers as bracketed-paste + Enter; cancel/deny as ESC. Guarded by `canSend`
 * so a mobile presence-lock blocks desktop sends the same way it guards xterm.
 *
 * Dismiss-on-answer (mobile parity): the live status lingers after answering —
 * the agent emits a post-tool event carrying the same prompt — so we track the
 * answered prompt by content key and hide the card until a genuinely different
 * prompt arrives. The dismissal resets once the prompt clears, so a later
 * (even identical) prompt shows again instead of staying hidden.
 */
export type NativeChatVisibleCard = {
  /** The card to show now: null when there is none, it was just answered, or
   *  sends are locked (mobile presence-lock). */
  card: InteractivePromptCard
  cardKey: string | null
  /** The card was answered but the agent still reports the same prompt: its
   *  answer may not have landed yet, so nothing else may be typed in. */
  awaitingMoveOn: boolean
  /** Hide this card until a genuinely different prompt arrives. */
  dismiss: () => void
}

/** The live card for a pane, shared by the card itself and the composer (which
 *  must not paste into a prompt the card is answering). */
export function useNativeChatVisibleCard(paneKey: string, canSend: boolean): NativeChatVisibleCard {
  const interactivePrompt = useAppStore(
    (s) => s.agentStatusByPaneKey[paneKey]?.interactivePrompt ?? null
  )
  // Thread the sibling `toolName` from the same status entry so the question
  // parser can dispatch through the tool's registered parser (mobile parity).
  const interactiveToolName = useAppStore((s) => s.agentStatusByPaneKey[paneKey]?.toolName ?? null)

  const parsed = useMemo(
    () => parseInteractivePrompt(interactivePrompt, interactiveToolName ?? undefined),
    [interactivePrompt, interactiveToolName]
  )
  const cardKey = useMemo(() => nativeChatCardDismissKey(parsed), [parsed])
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  // Forget the dismissal once the prompt clears so a fresh prompt can show.
  const present = parsed != null
  useEffect(() => {
    if (!present) {
      setDismissedKey(null)
    }
  }, [present])

  const dismiss = useCallback(() => setDismissedKey(cardKey), [cardKey])
  const answered = parsed != null && cardKey === dismissedKey
  const card = !parsed || !canSend || answered ? null : parsed
  return { card, cardKey, awaitingMoveOn: answered, dismiss }
}

export function NativeChatInteractiveCard({
  visible,
  send
}: {
  visible: NativeChatVisibleCard
  send: NativeChatInteractiveSend
}): React.JSX.Element | null {
  const { card, cardKey, dismiss } = visible
  const { sendAnswer, sendRaw, cancel } = send

  if (!card) {
    return null
  }
  if (card.kind === 'question') {
    return (
      <NativeChatQuestionCard
        key={cardKey ?? 'question'}
        prompt={card.prompt}
        onAnswer={(text) => {
          dismiss()
          sendAnswer(text)
        }}
        onCancel={() => {
          dismiss()
          cancel()
        }}
      />
    )
  }
  return (
    <NativeChatApprovalCard
      approval={card.approval}
      onChoose={(raw) => {
        dismiss()
        sendRaw(raw)
      }}
    />
  )
}
