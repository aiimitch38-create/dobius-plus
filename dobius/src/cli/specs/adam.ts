import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const ONE_ADAM =
  'This is the same ADAM as voice and the Board thread: one Hermes session, one thread. The message and his reply are saved in his thread.'

export const ADAM_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['adam', 'ask'],
    summary: 'Send ADAM a message in his thread',
    usage: 'dobius adam ask --text <message> [--source <name>] [--wait] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text', 'source', 'wait'],
    notes: [
      ONE_ADAM,
      'Dobius+ shows a dialog asking you to confirm in the app first; nothing is sent unless someone clicks it there.',
      'Without --wait the command returns once the message is sent and ADAM answers in his thread. With --wait it prints his reply (up to about 4 minutes).',
      '--source names the tool or agent sending it (letters, numbers, spaces, dot, dash, underscore; up to 40). Messages are at most 1500 characters.',
      'Refused while ADAM is answering something else, and refused when run by ADAM himself (his own Hermes process), so he cannot message himself in a loop.'
    ],
    examples: [
      'dobius adam ask --text "What is running on the Board?" --wait',
      'dobius adam ask --text "Build finished, tests pass" --source codex-worker'
    ]
  },
  {
    path: ['adam', 'say'],
    summary: 'Make ADAM say something out loud',
    usage: 'dobius adam say --text <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text'],
    notes: [
      'Speaks the text in ADAM’s voice on this Mac. It is not sent to ADAM and not saved in his thread.',
      'At most 2000 characters.'
    ],
    examples: ['dobius adam say --text "The build is done."']
  },
  {
    path: ['adam', 'status'],
    summary: 'Show whether ADAM is busy and whether voice mode is on',
    usage: 'dobius adam status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['dobius adam status', 'dobius adam status --json']
  },
  {
    path: ['adam', 'mode'],
    summary: 'Turn ADAM voice mode (the Cmd+T shortcut) on or off',
    usage: 'dobius adam mode <on|off> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'state'],
    positionalArgs: ['state'],
    notes: [
      'Same switch as voice mode in Settings. Turning it off also stops an answer ADAM is speaking.',
      'Turning it on can fail when another app already holds Cmd+T; the command says so.'
    ],
    examples: ['dobius adam mode on', 'dobius adam mode off --json']
  }
]
