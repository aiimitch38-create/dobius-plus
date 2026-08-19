/**
 * Machine-readable + human-readable report for the communications command
 * verification harness. See run-verification.test.ts for the runner that
 * produces one of these; this module only owns the shape and the writer.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Verdict } from './classify'

export type CommandReportEntry = {
  command: string
  /** From command-manifest.json at the time this report was generated. */
  manifestStatus: 'implemented' | 'pending' | 'removed-pending' | 'unclassified'
  disposition: string | null
  verdict: Verdict
  detail?: string
  /**
   * 'scenario': dispatched with a hand-built, source-verified fixture (core
   * or a family module) — an ERROR here is a genuine finding.
   * 'empty-fallback': dispatched with `{}` because no scenario exists yet
   * for this command (Pass 2 in run-verification.test.ts) — an ERROR here
   * is ambiguous: it may mean the command genuinely errors, OR it may mean
   * the command actually works fine and simply rejected the empty fixture's
   * missing required fields. Only UNIMPLEMENTED is unambiguous either way
   * (dobiusCommunications.ts's switch dispatches on command name alone, so
   * "not implemented" doesn't depend on args). See VerificationReport's
   * `unverifiedEmptyFallbackErrors` for the count this distinction exists
   * to surface.
   */
  fixtureSource: 'scenario' | 'empty-fallback'
}

export type VerificationReport = {
  generatedAt: string
  totalCommands: number
  counts: Record<Verdict, number>
  /**
   * "regressed": manifest says implemented, but this run did not verify it
   * PASS. This is the install-gate signal — see run-verification.test.ts.
   */
  regressed: string[]
  /**
   * Count of entries with `verdict: 'ERROR'` and `fixtureSource:
   * 'empty-fallback'` — commands with no scenario yet whose real handler
   * rejected the `{}` fallback. NOT necessarily bugs: as more family
   * scenario modules land, this number should trend toward 0 (each one
   * either gets a real fixture and becomes PASS/a genuine ERROR, or turns
   * out to still be unimplemented and reports UNIMPLEMENTED instead). A
   * high number here means "add more scenarios," not "N commands are
   * broken" — see summaryLine.
   */
  unverifiedEmptyFallbackErrors: number
  entries: CommandReportEntry[]
  relay: { available: boolean; reason?: string }
}

export function buildReport(
  entries: CommandReportEntry[],
  relay: { available: boolean; reason?: string }
): VerificationReport {
  const counts: Record<Verdict, number> = {
    PASS: 0,
    UNIMPLEMENTED: 0,
    SHAPE_FAIL: 0,
    ERROR: 0,
    SKIPPED: 0
  }
  const regressed: string[] = []
  let unverifiedEmptyFallbackErrors = 0
  for (const entry of entries) {
    counts[entry.verdict] += 1
    // SKIPPED is excluded on purpose: it means the harness's environment
    // could not verify the command this run (e.g. port 3300 already held by
    // a live Dobius+ instance), which is not evidence the command itself
    // regressed. Only a real UNIMPLEMENTED/SHAPE_FAIL/ERROR outcome on a
    // command the manifest claims is implemented counts as a regression.
    if (entry.manifestStatus === 'implemented' && entry.verdict !== 'PASS' && entry.verdict !== 'SKIPPED') {
      regressed.push(entry.command)
    }
    if (entry.verdict === 'ERROR' && entry.fixtureSource === 'empty-fallback') {
      unverifiedEmptyFallbackErrors += 1
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    totalCommands: entries.length,
    counts,
    regressed,
    unverifiedEmptyFallbackErrors,
    entries: [...entries].sort((a, b) => a.command.localeCompare(b.command)),
    relay
  }
}

export function summaryLine(report: VerificationReport): string {
  const { counts } = report
  return (
    `Communications command verification: ${report.totalCommands} commands — ` +
    `${counts.PASS} PASS, ${counts.UNIMPLEMENTED} UNIMPLEMENTED, ` +
    `${counts.SHAPE_FAIL} SHAPE_FAIL, ${counts.ERROR} ERROR, ${counts.SKIPPED} SKIPPED. ` +
    `${report.regressed.length} regressed (implemented but not verified PASS). ` +
    `Of the ${counts.ERROR} ERROR, ${report.unverifiedEmptyFallbackErrors} used the empty-args ` +
    `fallback (no scenario yet — may be working commands, not proven bugs; ` +
    `add a scenario to find out) vs ${counts.ERROR - report.unverifiedEmptyFallbackErrors} from a ` +
    `real, hand-built fixture (genuine findings).`
  )
}

export function writeReport(report: VerificationReport, outFile: string): void {
  mkdirSync(path.dirname(outFile), { recursive: true })
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`)
}
