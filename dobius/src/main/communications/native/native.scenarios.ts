/**
 * Scenario fixtures for the native-ux RPC family (rpc-methods.ts), for the
 * communications command verification harness's composable scenario
 * registry (src/main/communications/verify/command-scenario.ts's
 * `SCENARIO_STEPS` family contract — see that file's top doc comment). The
 * harness owner splices this in with one import + one array-spread; this
 * module never edits verify/ itself.
 *
 * Types come from the shared contract at '../scenario-contract', which
 * lives outside verify/ specifically so family modules like this one can
 * import it without crossing the tsconfig project boundary that excludes
 * verify/ from config/tsconfig.node.json (see that file's own doc comment).
 *
 * SEAM — every step here sets via: 'method' and dispatches by RPC METHOD
 * name ('nativeUx.getIdleSeconds', ...) through the real communications
 * gateway (sender-trust check + request validation + allowlist +
 * dispatcher). The vendored Buzz client reached the same features through
 * snake_case Tauri commands (get_os_idle_seconds,
 * perform_sidebar_default_haptic, ... — see its dobiusCommunications.ts
 * switch); that vendored client is being deleted, so this family verifies
 * over the gateway seam only. All five method names below are already in
 * COMMUNICATIONS_RUNTIME_METHODS (src/shared/communications-bridge.ts), so
 * a missing-allowlist regression surfaces as a loud ERROR, not a silent
 * skip.
 *
 * ONLY 5 of this family's 14 RPC methods get a fixture here — the rest are
 * GUI-dependent and intentionally have NO step:
 *
 *   nativeUx.titleBarDoubleClick      (BrowserWindow + systemPreferences)
 *   nativeUx.setWindowVibrancy       (BrowserWindow.getAllWindows)
 *   nativeUx.trayUpdateAgentActivity (Tray + Menu)
 *   nativeUx.trayClearAgentActivity  (Tray + Menu)
 *   nativeUx.showNotification        (Notification)
 *   media.copyTextToClipboard        (clipboard)
 *   media.copyImageToClipboard       (clipboard + nativeImage)
 *   media.downloadFile               (dialog)
 *   media.downloadImage              (dialog + nativeImage)
 *
 * This harness's electron mock (runtime-bridge-harness.ts) only stubs
 * `app`, `ipcMain`, `BrowserWindow.fromId`, and `webContents.fromId`.
 * Every method above touches one of the Electron APIs the mock does not
 * provide and throws under it — not a bug in the implementation, a genuine
 * gap between "headless test process" and "running Electron app". Rather
 * than fake a passing fixture for those, they simply have no step here (see
 * the GRACEFUL DEGRADATION POLICY in command-scenario.ts's doc comment: no
 * fixture = Pass 2's empty-args fallback, an honest ERROR under the real
 * gateway, not a fake PASS).
 */
import { fail, isRecord, ok, type ScenarioStep } from '../scenario-contract'

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    // Real Electron powerMonitor is unavailable under the harness's mock,
    // but idle-time.ts's own try/catch turns that throw into `null` — the
    // SAME `null` the real contract documents for "platform can't answer".
    // So this genuinely round-trips end to end without faking anything.
    command: 'nativeUx.getIdleSeconds',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r) =>
      r === null || (typeof r === 'number' && Number.isFinite(r) && r >= 0)
        ? ok()
        : fail(`expected null or a non-negative number, got ${JSON.stringify(r)}`)
  },
  {
    // Pure — no Electron API involved at all (see haptic-feedback.ts: it's
    // a deliberate no-op, not a stub). Unlike the retiring vendor switch,
    // which discarded the handler's return value behind `result: undefined`,
    // the gateway hands the structured no-op result straight through —
    // assert its exact documented shape instead of a bare undefined check.
    command: 'nativeUx.performSidebarHaptic',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r) =>
      isRecord(r) && r.performed === false && r.reason === 'not_supported_by_electron'
        ? ok()
        : fail(`expected the documented haptic no-op result, got ${JSON.stringify(r)}`)
  },
  {
    // Seeds the in-process tray action queue (pure — see
    // tray-action-queue.ts) so the next step can verify it round-trips.
    // The method seam returns the handler's own receipt ({ requeued: N })
    // where the vendor switch returned undefined — assert the count too.
    command: 'nativeUx.trayRequeueActions',
    via: 'method',
    args: () => ({ actions: [{ kind: 'newChannel' }] }),
    shapeCheck: (r) =>
      isRecord(r) && r.requeued === 1
        ? ok()
        : fail(`expected { requeued: 1 }, got ${JSON.stringify(r)}`)
  },
  {
    // Drains the SAME queue the previous step seeded. Nothing else in the
    // manifest touches nativeUx.tray* take/requeue (the activity-tray pair
    // is GUI-dependent and excluded above), so this is a deterministic,
    // exact-shape check, not a loose "is it an array" placeholder.
    command: 'nativeUx.trayTakeActions',
    via: 'method',
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
    command: 'updater.isAutoUpdateSupported',
    via: 'method',
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
