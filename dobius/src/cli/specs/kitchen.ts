import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const KITCHEN_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['kitchen', 'status'],
    summary: 'Show whether the kitchen manager is on and how many cooks are running',
    usage: 'dobius kitchen status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'The kitchen manager starts one restricted agent (a cook), in its own workspace, for each Kanban card Carson sent to the kitchen. It is off by default.',
      'Read-only. The kitchen is turned on and off in the app (Settings, Agents), and only Carson can send a card to it, from the card on the Kanban.',
      'Nothing new starts while the kitchen is off or the crew is paused.'
    ],
    examples: ['dobius kitchen status', 'dobius kitchen status --json']
  }
]
