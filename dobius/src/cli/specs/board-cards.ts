import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const CARD_NOTE =
  '--card is the card id (preferred: it never changes) or its title as shown on the Board, ignoring letter case. Two cards with the same title are refused; use the id. `dobius board list --json` shows both.'
const WORKTREE_NOTE = '--worktree defaults to active (the worktree enclosing the current directory).'

export const BOARD_CARD_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['board', 'list'],
    summary: 'List every card on a worktree Board (consoles, notes, web tiles, orchestrators...)',
    usage: 'dobius board list [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      WORKTREE_NOTE,
      'Text columns: card id, kind, status (consoles: running, not running or pane unclear), terminal handle, title.',
      '--json rows: id, kind, title, preview, status, tabId, agent, role, handle. At most 500 cards; truncated says when there are more.',
      'Read-only. A console handle changes when it restarts; the card id does not.'
    ],
    examples: ['dobius board list', 'dobius board list --worktree branch:main --json']
  },
  {
    path: ['board', 'restart'],
    summary: 'Restart the agent in a Board console card (fresh terminal, same card)',
    usage: 'dobius board restart --card <id-or-title> [--force] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'card', 'force', 'worktree'],
    notes: [
      CARD_NOTE,
      WORKTREE_NOTE,
      'Same as Restart on the card: it keeps the card, its account and any restricted launch (such as a bug auto-fix console), and saves the Board before the old terminal closes.',
      'A console whose agent is working is refused (board_card_busy) unless you pass --force, which stops its current turn.',
      'Refused with crew_paused while Pause crew is on. Needs the Dobius+ window open (board_window_unavailable otherwise).'
    ],
    examples: ['dobius board restart --card "Builder 1"', 'dobius board restart --card 7f3c... --force --json']
  },
  {
    path: ['board', 'rename'],
    summary: 'Rename a Board card',
    usage: 'dobius board rename --card <id-or-title> --title <new title> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'card', 'title', 'worktree'],
    notes: [CARD_NOTE, WORKTREE_NOTE, 'Titles are at most 200 characters. An orchestrator card is renamed too.'],
    examples: ['dobius board rename --card "Codex 2" --title "Tests"']
  },
  {
    path: ['board', 'note'],
    summary: 'Add a sticky note to a Board, next to a card or in free space',
    usage: 'dobius board note --text <text> [--card <id-or-title>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text', 'card', 'worktree'],
    notes: [
      'With --card the note goes just to the right of that card; without it, in a free spot on screen.',
      CARD_NOTE,
      WORKTREE_NOTE,
      'Text is at most 4000 characters. The note only sits on the Board; it is not typed into any agent.'
    ],
    examples: ['dobius board note --text "Waiting on review" --card "Builder 1" --json']
  },
  {
    path: ['board', 'close'],
    summary: 'Close a Board card; for a console this ends its agent and closes its terminal',
    usage: 'dobius board close --card <id-or-title> [--force] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'card', 'force', 'worktree'],
    notes: [
      CARD_NOTE,
      WORKTREE_NOTE,
      'This cannot be undone from the CLI. A console whose agent is working is refused (board_card_busy) unless you pass --force.',
      'The card is removed and the Board saved first; only then does the terminal close. If the save fails the terminal is left open.'
    ],
    examples: ['dobius board close --card "Old notes"', 'dobius board close --card 7f3c... --force --json']
  }
]
