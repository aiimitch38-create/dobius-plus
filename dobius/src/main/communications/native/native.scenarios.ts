/**
 * Scenario fixtures for the native-ux command family, for the
 * communications command verification harness's composable scenario
 * registry (src/main/communications/verify/command-scenario.ts's
 * `SCENARIO_STEPS` family contract — see that file's top doc comment). The
 * harness owner splices this in with one import + one array-spread in that
 * file (`import { SCENARIO_STEPS as nativeSteps } from '../native/native.scenarios'`
 * is already stubbed there, commented out); this module never edits verify/
 * itself.
 *
 * Types come from the shared contract at '../scenario-contract', which
 * lives outside verify/ specifically so family modules like this one can
 * import it without crossing the tsconfig project boundary that excludes
 * verify/ from config/tsconfig.node.json (see that file's own doc comment).
 *
 * ONLY 5 of this family's 14 commands get a fixture here — see this task's
 * build report (SCENARIOS section) for the full split and why. Short
 * version: this harness's electron mock (runtime-bridge-harness.ts) only
 * stubs `app`, `ipcMain`, `BrowserWindow.fromId`, and `webContents.fromId`.
 * Every command whose real implementation touches `Notification`, `Tray`,
 * `Menu`, `clipboard`, `dialog`, `nativeImage`, or `BrowserWindow.getAllWindows`
 * throws under this mock — not a bug in the implementation, a genuine gap
 * between "headless test process" and "running Electron app". Rather than
 * fake a passing fixture for those, they simply have no step here (see the
 * GRACEFUL DEGRADATION POLICY in command-scenario.ts's doc comment: no
 * fixture = Pass 2's empty-args fallback, an honest ERROR under the real
 * dispatch seam once wired, not a fake PASS).
 */
import { ok, fail, isRecord, type ShapeOutcome, type ScenarioStep } from '../scenario-contract'

function expectUndefined(result: unknown): ShapeOutcome {
  return result === undefined ? ok() : fail(`expected undefined, got ${JSON.stringify(result)}`)
}

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    // Real Electron powerMonitor is unavailable under the harness's mock,
    // but idle-time.ts's own try/catch turns that throw into `null` — the
    // SAME `null` the real contract documents for "platform can't answer".
    // So this genuinely round-trips end to end without faking anything.
    command: 'get_os_idle_seconds',
    args: () => ({}),
    shapeCheck: (r) =>
      r === null || (typeof r === 'number' && Number.isFinite(r) && r >= 0)
        ? ok()
        : fail(`expected null or a non-negative number, got ${JSON.stringify(r)}`)
  },
  {
    // Pure — no Electron API involved at all (see haptic-feedback.ts: it's
    // a deliberate no-op, not a stub). Always resolves the same way.
    command: 'perform_sidebar_default_haptic',
    args: () => ({}),
    shapeCheck: expectUndefined
  },
  {
    // Seeds the in-process tray action queue (pure — see
    // tray-action-queue.ts) so the next step can verify it round-trips.
    command: 'requeue_tray_actions',
    args: () => ({ actions: [{ kind: 'newChannel' }] }),
    shapeCheck: expectUndefined
  },
  {
    // Drains the SAME queue the previous step seeded. Nothing else in the
    // manifest touches nativeUx.tray* (native-ux owns take/requeue
    // exclusively), so this is a deterministic, exact-shape check, not a
    // loose "is it an array" placeholder.
    command: 'take_tray_actions',
    args: () => ({}),
    shapeCheck: (r) =>
      Array.isArray(r) && r.length === 1 && isRecord(r[0]) && r[0].kind === 'newChannel'
        ? ok()
        : fail(`expected the previously-requeued newChannel action, got ${JSON.stringify(r)}`)
  },
  {
    // Pure platform/env check (see auto-update-support.ts) — no Electron
    // API. Strict on darwin/win32 (always true there); a plain boolean
    // check elsewhere since Linux's answer legitimately depends on whether
    // this process happens to be running from an AppImage.
    command: 'is_auto_update_supported',
    args: () => ({}),
    shapeCheck: (r) => {
      if (typeof r !== 'boolean') {
        return fail(`expected a boolean, got ${JSON.stringify(r)}`)
      }
      if (process.platform === 'darwin' || process.platform === 'win32') {
        return r === true ? ok() : fail(`expected true on ${process.platform}`)
      }
      return ok()
    }
  }
]
