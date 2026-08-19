/**
 * Wires `window.dobiusCommunications.invoke` to a REAL `RpcDispatcher`
 * running a REAL, restricted method registry, so "dobius-rpc"-disposition
 * commands (the ones that route through `invokeDobiusRuntime` inside
 * vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts) exercise
 * actual production dispatch and handler code — not a hand-rolled mock.
 *
 * What is real: `RpcDispatcher`, its zod parameter validation, and every
 * handler in `ALL_RPC_METHODS` (the full main-app RPC registry, which now
 * includes the Communications-specific `COMMUNICATIONS_AGENT_METHODS`).
 *
 * What is NOT real (see LIMITS in the harness's returned report): the
 * transport. Production goes renderer -> preload -> ipcMain.handle ->
 * communications-gateway.ts -> dispatcher. This harness calls
 * `dispatcher.dispatch()` directly, skipping the Electron IPC hop and the
 * gateway's sender-trust check, because launching a real Electron window is
 * out of scope (see the harness owner's guardrails). The method HANDLERS
 * dispatched to are identical to production; only the wire between the
 * renderer and the dispatcher is stubbed.
 *
 * `electron`'s `app.getPath('userData')` is mocked to an isolated scratch
 * directory (see `ISOLATED_USER_DATA_DIR`) instead of the real
 * `~/Library/Application Support/dobius-plus`. Without this,
 * `agents-store.ts` would read and write Carson's real, live agent roster —
 * exactly the kind of side effect a verification run must never have.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'

export const ISOLATED_USER_DATA_DIR = mkdtempSync(
  path.join(tmpdir(), 'dobius-comms-verify-userdata-')
)

// Why `vi.hoisted`: vi.mock('electron', ...) is hoisted above this file's own
// imports by Vitest's transform, but the factory closure still needs a value
// that exists at hoist time — vi.hoisted guarantees ISOLATED_USER_DATA_DIR-
// style constants used inside the factory are themselves evaluated first.
const electronMock = vi.hoisted(() => ({
  app: {
    // Filled in by installElectronMock() before any handler runs; a
    // placeholder default so accidental early access fails loudly instead
    // of writing into the repo. Declared with the real `(name: string) =>
    // string` shape (not a zero-arg placeholder) so the later real
    // assignment in installElectronMock() type-checks against it.
    getPath: (_name: string): string => {
      throw new Error('electron mock used before installElectronMock() ran')
    }
  },
  ipcMain: {
    handle: () => {},
    removeHandler: () => {},
    on: () => {},
    removeListener: () => {}
  },
  BrowserWindow: { fromId: () => null },
  webContents: { fromId: () => null }
}))

vi.mock('electron', () => electronMock)

/**
 * Repoints the mocked `app.getPath('userData')` at the isolated scratch
 * directory. Must run before importing anything that transitively imports
 * `agents-store.ts` (agent.list / agent.create / agent.update / agent.delete),
 * which is why this module's `vi.mock('electron', ...)` above is
 * unconditional and file-top-level: Vitest hoists it ahead of this file's
 * own static imports, and this file must be the first thing the harness
 * entrypoint imports.
 */
export function installElectronMock(): void {
  electronMock.app.getPath = (name: string) =>
    name === 'userData' ? ISOLATED_USER_DATA_DIR : tmpdir()
}

installElectronMock()

// Imported AFTER the mock is installed (module top-level `import` statements
// are themselves hoisted by the JS spec, but Vitest additionally hoists the
// `vi.mock` call above them within this same file, which is what makes this
// ordering safe — see https://vitest.dev/api/vi.html#vi-mock).
import { RpcDispatcher } from '../../runtime/rpc/dispatcher'
import type { DobiusRuntimeService } from '../../runtime/dobius-runtime'
// The full main-app RPC registry (agent.*, accounts.*, team.*, git/GitHub/
// SSH/terminal/... — everything). Registering all of it is safe: methods are
// just data (name + zod schema + handler function) stored in a Map at
// registration time (see RpcDispatcher/buildRegistry) — nothing executes
// until a specific method is actually dispatched. Only entries this harness
// actually invokes ever touch `runtime` or do real work, so a handler this
// harness has no story for (say, a GitHub API call) simply never runs
// unless some scenario fixture calls it. Registering the real, complete
// registry — instead of hand-picking groups — is what "prefer registering
// the real registry over hand-listing groups" (this harness's own coverage
// gap, found by build-agent-lifecycle) means in practice: a new method
// group landing in ALL_RPC_METHODS is automatically covered here too,
// rather than silently falling behind again the next time a family needs
// one this file hasn't heard of.
// COMMUNICATIONS_AGENT_METHODS is spread into ALL_RPC_METHODS by
// runtime/rpc/methods/index.ts, so importing it here again would register
// every agentObserver.* handler twice and RpcDispatcher would throw
// duplicate_rpc_method before a single command ran.
import { ALL_RPC_METHODS } from '../../runtime/rpc/methods'
import type { RpcAnyMethod } from '../../runtime/rpc/core'

export type BridgeInvokeResult =
  | { version: 1; id: string; ok: true; result: unknown }
  | { version: 1; id: string; ok: false; error: { code: string; message: string } }

/**
 * `accounts.list` (the only ACCOUNT_METHODS entry any command in the
 * manifest actually calls, via discover_acp_providers) needs
 * `runtime.getAccountsSnapshot()` / `refreshAccountsForMobile()`, which live
 * on `DobiusRuntimeService` but are only wired up when the real app calls
 * `runtime.configureAccountServices(...)` during startup — well outside this
 * harness's scope (that path spawns real `claude`/`codex` CLI probes tied to
 * the live Electron app). Rather than fabricate a fake snapshot (which would
 * make `discover_acp_providers` a mocked PASS instead of a real one), this
 * stub intentionally leaves account services unconfigured so the REAL
 * `requireAccountServices()` guard throws its real error. That surfaces as
 * an honest ERROR verdict, not a fabricated PASS.
 */
function makeUnconfiguredRuntimeStub(): DobiusRuntimeService {
  return {
    // Every dispatch, regardless of method, stamps this into the response
    // envelope via RpcDispatcher.meta() — unlike the account-service methods
    // this is not something real production wiring would meaningfully vary
    // per command, so a fixed harness id is honest rather than a shortcut.
    getRuntimeId: () => 'communications-verify-harness'
  } as unknown as DobiusRuntimeService
}

let requestCounter = 0

/**
 * Builds the `{ invoke }` bridge object the harness installs at
 * `window.dobiusCommunications`. Registers the REAL, complete
 * `ALL_RPC_METHODS` registry — not a hand-picked subset. A handler this registers but that a Communications command never
 * actually calls just sits unused in the dispatch Map; only whichever
 * `runtime` members a DISPATCHED method's handler reads matter (see
 * `makeUnconfiguredRuntimeStub`'s doc for the ones already known to be
 * unreachable that way, e.g. account-service-backed methods).
 * `CUSTOM_AGENT_METHODS`/`TEAM_METHODS` (agents-store.ts/team-store.ts) use
 * the same `app.getPath('userData')` isolation — see `installElectronMock`
 * above — and so does everything else in `ALL_RPC_METHODS` that persists to
 * `userData` (confirmed no command this harness dispatches writes anywhere
 * else; see this task's report for what was actually run and observed).
 */
export function createRuntimeBridge(): { invoke: (command: string, args?: unknown) => Promise<BridgeInvokeResult> } {
  const methods: readonly RpcAnyMethod[] = ALL_RPC_METHODS
  const dispatcher = new RpcDispatcher({ runtime: makeUnconfiguredRuntimeStub(), methods })

  return {
    async invoke(command, args) {
      requestCounter += 1
      const id = `verify-${requestCounter}`
      const response = await dispatcher.dispatch({
        id,
        authToken: 'verification-harness',
        method: command,
        params: args
      })
      if (response.ok) {
        return { version: 1, id, ok: true, result: response.result }
      }
      return {
        version: 1,
        id,
        ok: false,
        error: { code: response.error.code, message: response.error.message }
      }
    }
  }
}
