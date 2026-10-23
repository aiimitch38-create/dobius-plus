import { describe, expect, it } from 'vitest'
import { concernText, riskyCategoryPhrase } from './plan-concern-text'
import { riskyTextConcerns } from './plan-safety'

const CATEGORY_SAMPLES: Record<string, string> = {
  delete: 'rm -rf build',
  history: 'git reset --hard',
  publish: 'npm publish',
  credentials: 'print the api key',
  install: 'brew install jq',
  files: 'chmod 777 file',
  admin: 'sudo ls',
  permissions: 'claude --yolo'
}

describe('concernText risky-text', () => {
  it('reads naturally for sudo', () => {
    expect(concernText({ kind: 'risky-text', category: 'admin', text: 'sudo ls' })).toBe(
      'Text that runs as admin (sudo): "sudo ls"'
    )
  })

  it('has a written phrase for every risky category the screen can raise', () => {
    for (const [category, sample] of Object.entries(CATEGORY_SAMPLES)) {
      const [concern] = riskyTextConcerns(sample, null)
      expect(concern).toMatchObject({ kind: 'risky-text', category })
      const phrase = riskyCategoryPhrase(category)
      expect(phrase).not.toContain('{{')
      expect(phrase).not.toMatch(/risky \(/)
    }
  })

  it('falls back without a broken sentence for an unknown category', () => {
    expect(riskyCategoryPhrase('mystery')).toBe('could be risky (mystery)')
  })
})
