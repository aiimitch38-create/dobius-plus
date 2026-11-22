// Pure decision for a composer send while an interactive card is up (ported
// from Line A #26, "answer question cards in Chat"). A plain paste + Enter into
// a question or permission prompt would pick whatever option is highlighted,
// so the composer must never do that while a card is showing:
//   - a one-question card takes the typed words as its answer, through the
//     card's own answer path (the same one its "Other…" row uses);
//   - anything else keeps the draft and tells you to use the card.

import { translate } from '@/i18n/i18n'
import type { InteractivePromptCard } from './native-chat-interactive-prompt'

export type NativeChatComposerCardGate =
  | { kind: 'pass' }
  | { kind: 'answer' }
  | { kind: 'hold'; reason: 'answer-in-flight' | 'pick-option' | 'answer-in-card' | 'no-images' }

export function gateNativeChatComposerSend(args: {
  /** The card currently showing (null when none, or it was just answered). */
  card: InteractivePromptCard
  /** An earlier card answer is still being typed into the terminal. */
  answering: boolean
  text: string
  imageCount: number
  isSlashCommand: boolean
}): NativeChatComposerCardGate {
  // Why: the card is hidden the moment it is answered, but the answer's paste
  // and Enter are still on their way; a send now would land in the prompt.
  if (args.answering) {
    return { kind: 'hold', reason: 'answer-in-flight' }
  }
  const { card } = args
  if (!card) {
    return { kind: 'pass' }
  }
  if (card.kind === 'approval') {
    return { kind: 'hold', reason: 'pick-option' }
  }
  if (card.prompt.questions.length !== 1 || args.isSlashCommand) {
    return { kind: 'hold', reason: 'answer-in-card' }
  }
  if (args.imageCount > 0) {
    return { kind: 'hold', reason: 'no-images' }
  }
  return args.text.trim().length > 0 ? { kind: 'answer' } : { kind: 'hold', reason: 'answer-in-card' }
}

/** What the composer tells you when it holds a send. */
export function nativeChatCardHoldNotice(
  reason: Extract<NativeChatComposerCardGate, { kind: 'hold' }>['reason']
): string {
  switch (reason) {
    case 'answer-in-flight':
      return translate(
        'components.native-chat.cardGate.answerInFlight',
        'One moment, your answer is still going in.'
      )
    case 'pick-option':
      return translate(
        'components.native-chat.cardGate.pickOption',
        'Pick an option in the card above first. Nothing was sent.'
      )
    case 'no-images':
      return translate(
        'components.native-chat.cardGate.noImages',
        'Answer the question first, then send the images. Nothing was sent.'
      )
    case 'answer-in-card':
      return translate(
        'components.native-chat.cardGate.answerInCard',
        'Answer the questions in the card above first. Nothing was sent.'
      )
  }
}

/** The composer placeholder while a card is up, or null for the default. */
export function nativeChatCardComposerPlaceholder(card: InteractivePromptCard): string | null {
  if (!card) {
    return null
  }
  if (card.kind === 'question' && card.prompt.questions.length === 1) {
    return translate(
      'components.native-chat.cardGate.typeAnswerPlaceholder',
      'Type your own answer and press Enter…'
    )
  }
  return translate('components.native-chat.cardGate.useCardPlaceholder', 'Use the card above first…')
}
