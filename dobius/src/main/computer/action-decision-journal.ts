import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type ComputerDecisionEntry = {
  method: string
  app: string
  target: string
  verdict: 'allow' | 'block'
  rule: string | null
  source: 'rules'
  outcome: 'ok' | 'error' | 'blocked'
  errorCode?: string
}

/**
 * Append-only record of every agent action decision and its outcome: the labeled examples a
 * future Laya classifier is evaluated against. Never stores typed text, screenshots or tree text.
 */
export async function journalComputerDecision(entry: ComputerDecisionEntry): Promise<void> {
  try {
    const { app } = await import('electron')
    const path = join(app.getPath('userData'), 'computer-use', 'decisions.jsonl')
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, {
      mode: 0o600
    })
  } catch (error) {
    // The journal is evidence for later evaluation; it must never block or fail an action.
    void error
  }
}
