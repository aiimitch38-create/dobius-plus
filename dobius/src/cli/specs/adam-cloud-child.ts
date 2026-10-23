import type { CommandSpec } from '../args'

export const ADAM_CLOUD_CHILD_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['seal-adam-intent'],
    summary: 'Seal an approved ADAM intent through the private local runtime',
    usage: 'dobius seal-adam-intent --request-stdin [--json]',
    allowedFlags: ['help', 'json', 'request-stdin'],
    notes: ['Reads a bounded JSON request from stdin; requires an enrolled ADAM service principal.']
  },
  {
    path: ['submit-adam-child'],
    summary: 'Submit a sealed approved ADAM child through the private local runtime',
    usage: 'dobius submit-adam-child --request-stdin [--json]',
    allowedFlags: ['help', 'json', 'request-stdin'],
    notes: [
      'Reads a bounded sealed intent request from stdin. Legacy plaintext grants and remote selection are refused.'
    ]
  },
  {
    path: ['lookup-adam-child'],
    summary: 'Read an existing exact ADAM child without submitting work',
    usage: 'dobius lookup-adam-child --request-stdin [--json]',
    allowedFlags: ['help', 'json', 'request-stdin'],
    notes: [
      'Reads a bounded sealed intent request from stdin and returns the existing child or null.'
    ]
  }
]
