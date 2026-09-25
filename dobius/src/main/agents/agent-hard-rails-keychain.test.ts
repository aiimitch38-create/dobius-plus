import { describe, expect, it } from 'vitest'
import { evaluateAgentHardRails } from './agent-hard-rails'

const context = { agentId: 'atlas', profile: 'manual' }
const CREDENTIAL_REASON = 'Hard rail: credential material is not available to agents.'

function reason(command: string): string | null {
  return evaluateAgentHardRails(context, 'Bash', { command })?.reason ?? null
}

// Text only: none of these commands is ever run.
describe('keychain secret rail', () => {
  it.each([
    'security find-generic-password -s "Claude Code-credentials" -w',
    '/usr/bin/security find-generic-password -a x -w',
    'security -q find-internet-password -s github.com -w',
    'security dump-keychain -d login.keychain',
    'security export -k login.keychain -t certs -o /tmp/x',
    'echo hi; security find-generic-password -ws "Claude Code-credentials" | base64',
    'TOKEN=$(security find-generic-password -s x -w)',
    `bash -c 'security find-generic-password -s x -w'`
  ])('denies %s', (command) => {
    expect(reason(command)).toBe(CREDENTIAL_REASON)
  })

  it.each([
    'security list-keychains',
    'security find-certificate -a -c "Apple" -Z',
    'git commit -m "tighten security export rules"',
    'grep -rn security src/',
    'npm audit --audit-level=high'
  ])('allows %s', (command) => {
    expect(reason(command)).not.toBe(CREDENTIAL_REASON)
  })
})
