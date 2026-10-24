import { translate } from '@/i18n/i18n'

/** A skill scan that has not answered by now is treated as finished-with-nothing. */
export const SKILL_SCAN_TIMEOUT_MS = 15_000

export class SkillScanTimeoutError extends Error {
  constructor() {
    super('Skill scan timed out')
    this.name = 'SkillScanTimeoutError'
  }
}

/**
 * Resolves with the scan, or rejects with SkillScanTimeoutError after `ms`.
 * Why: a scan that never settled left the page on "Scanning skills" forever.
 */
export function withSkillScanTimeout<T>(
  scan: Promise<T>,
  ms: number = SKILL_SCAN_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SkillScanTimeoutError()), ms)
    scan.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** The toast text for a failed scan; a timeout says so and points at Refresh. */
export function skillScanErrorMessage(error: unknown): string {
  return error instanceof SkillScanTimeoutError
    ? translate('skills.scanTimedOut', 'The skill scan took too long and was stopped. Try Refresh.')
    : translate('auto.components.skills.SkillsPage.ea72d6185b', 'Could not scan local skills')
}
