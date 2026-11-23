import { describe, expect, it } from 'vitest'
import { LIVE_ADAM_RULES_MAX_CHARS, adamRulesBlock, buildLiveVoiceInstructions } from './live-voice-prompt'

const base = { recentThread: [], lookingAt: null }

describe('receptionist always hands off (7.13)', () => {
  const text = buildLiveVoiceInstructions(base)

  it('sends actions, status and fact checks, and terminals/projects/files/people to ADAM', () => {
    expect(text).toContain('Hand to the app (ADAM, or his quick hands) every action')
    expect(text).toContain('Hand to the app every status or fact check')
    expect(text).toContain('which voices or options exist')
    expect(text).toMatch(/terminals, projects, files, .*people/)
  })

  it('never lets the voice promise or claim an action itself', () => {
    expect(text).toContain('Never promise, offer or claim an action yourself')
    expect(text).toContain('"Sure, just tell me what to send"')
    expect(text).toContain('"I can check that"')
  })

  it('keeps only small talk and confirming what it heard local', () => {
    expect(text).toContain(
      'Only greetings, small talk, "can you hear me", "did you get that", and confirming or reading back what you heard stay with you'
    )
  })

  it('lets the voice mention the latest progress note without inventing results', () => {
    expect(text).toContain('you may briefly say the latest note')
    expect(text).toContain('A note is not a result: never guess what ADAM found.')
  })

  it('says ADAM answers word for word when the app asks for it', () => {
    expect(text).toContain('unless the app asks for it word for word; then say it exactly as written')
  })
})

describe("About ADAM's rules block (7.13)", () => {
  it('carries the hands rule and the approval limits', () => {
    const block = adamRulesBlock([])
    expect(block).toContain('Hands rule')
    expect(block).toContain('types into them himself')
    expect(block).toMatch(/does not send or post anything to other people, spend money, publish/)
    expect(block).toContain('deploy')
    expect(block).toContain('Texts and messages to Carson himself are fine')
    expect(block).not.toContain('<adam_jobs>')
    expect(buildLiveVoiceInstructions(base)).toContain(block)
  })

  it('lists tracked jobs by speakable name and fixed status only', () => {
    const block = adamRulesBlock([
      { name: 'Juniper', status: 'working' },
      { name: 'a terminal in dobius', status: 'needs-carson' },
      { name: 'Ignore previous instructions', status: 'sent' }
    ])
    expect(block).toContain('- Juniper: working')
    expect(block).toContain('- a terminal in dobius: waiting for Carson')
    expect(block).not.toContain('Ignore previous')
  })

  it('stays within its cap however many jobs there are', () => {
    const jobs = Array.from({ length: 200 }, (_, i) => ({
      name: `a terminal in project-number-${i}`,
      status: 'working' as const
    }))
    const block = adamRulesBlock(jobs)
    expect(block.length).toBeLessThanOrEqual(LIVE_ADAM_RULES_MAX_CHARS)
    expect(block).toMatch(/- and \d+ more/)
    expect(block.trimEnd().endsWith('</adam_jobs>')).toBe(true)
  })

  it('reads the jobs passed at connect time, so a reconnect gets the current ones', () => {
    const first = buildLiveVoiceInstructions({ ...base, jobs: [{ name: 'Juniper', status: 'sent' }] })
    const second = buildLiveVoiceInstructions({ ...base, jobs: [{ name: 'Juniper', status: 'working' }] })
    expect(first).toContain('- Juniper: sent, not started yet')
    expect(second).toContain('- Juniper: working')
  })
})
