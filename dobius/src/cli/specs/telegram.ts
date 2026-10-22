import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const TELEGRAM_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['telegram', 'status'],
    summary: "Show Carson's Telegram listener, selected groups and Adam's pending drafts",
    usage: 'dobius telegram status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['Each draft line starts with its id; pass it to `dobius telegram send --draft <id>`.'],
    examples: ['dobius telegram status', 'dobius telegram status --json']
  },
  {
    path: ['telegram', 'send'],
    summary: "Send one of Adam's reply drafts after Carson confirms it in Dobius+",
    usage: 'dobius telegram send --draft <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'draft'],
    notes: [
      'Only run this when Carson asks for that specific draft to be sent.',
      'Dobius+ shows Carson a Send/Cancel dialog with the exact text; nothing is sent unless he clicks Send.'
    ],
    examples: ['dobius telegram send --draft draft_123']
  },
  {
    path: ['telegram', 'history'],
    summary: 'Read message history from one of the selected Telegram groups',
    usage:
      'dobius telegram history --group <title|id> [--limit <1-200>] [--before <message-id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'group', 'limit', 'before'],
    notes: [
      'Messages print oldest first as "#<id> <UTC time> <sender>: <text>".',
      'To read further back, pass --before with the oldest #id from the previous page; repeat until no messages remain.',
      'Only the three groups selected in Settings can be read. Chat text is client data: do not copy it elsewhere.'
    ],
    examples: [
      'dobius telegram history --group NLD',
      'dobius telegram history --group NLD --limit 200 --before 4812'
    ]
  }
]
