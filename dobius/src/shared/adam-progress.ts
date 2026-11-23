// What the live voice may hear about ADAM's running turn: one fixed phrase per
// kind of step. Why fixed: tool arguments and output are terminal text, file
// contents and web pages, and none of that may reach a voice model. Main
// picks the step; the window rebuilds the phrase from this table.

export const ADAM_PROGRESS_PHRASES = {
  'dobius-command': 'ADAM is running a dobius terminal command',
  terminal: 'ADAM is running a terminal command',
  'terminal-read': 'ADAM is reading a terminal',
  reading: 'ADAM is reading a file',
  editing: 'ADAM is editing a file',
  searching: 'ADAM is searching through files',
  web: 'ADAM is looking something up on the web',
  browser: 'ADAM is working in a web browser',
  memory: 'ADAM is checking his memory',
  tidying: 'ADAM is tidying his memory, which can take a couple of minutes',
  helper: 'ADAM handed part of this to a helper agent',
  tasks: 'ADAM is updating his task list',
  skills: 'ADAM is looking at one of his skills',
  code: 'ADAM is running some code',
  tool: 'ADAM is using one of his tools'
} as const

export type AdamProgressStep = keyof typeof ADAM_PROGRESS_PHRASES

export function isAdamProgressStep(value: unknown): value is AdamProgressStep {
  return typeof value === 'string' && Object.hasOwn(ADAM_PROGRESS_PHRASES, value)
}
