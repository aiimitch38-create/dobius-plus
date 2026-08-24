/**
 * The communications command verification harness.
 *
 * For every command in command-manifest.json (258 as of writing), drives it
 * through the REAL dispatch seam (`invokeTauri` in
 * vendor/buzz-desktop/src/shared/api/tauri.ts) against a REAL in-process
 * relay and a REAL RpcDispatcher — never a mock, never Buzz's upstream
 * e2eBridge fixture — and records one of: PASS, UNIMPLEMENTED, SHAPE_FAIL,
 * ERROR, SKIPPED. See classify.ts for the verdict rules, command-scenario.ts
 * for the composable scenario registry (core fixtures/oracles plus whatever
 * family modules have landed), relay-test-harness.ts and
 * runtime-bridge-harness.ts for how the real backends are stood up, and
 * report.ts for the JSON artifact this writes.
 *
 * Run: npx vitest run --config src/main/communications/verify/vitest.config.ts
 * (from the `dobius` directory).
 *
 * This file must import runtime-bridge-harness.ts (which mocks `electron`)
 * before anything else that could transitively import the real `electron`
 * module — see that file's own doc comment for why.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRuntimeBridge, createGatewayMethodInvoker, METHOD_SEAM_RENDERER_URL } from './runtime-bridge-harness'
import { startVerificationRelay, stopVerificationRelay, type RelayHarness } from './relay-test-harness'
import { classifyOutcome, skipped, type InvokeOutcome } from './classify'
import { SCENARIO, SCENARIO_COMMANDS, randomHexPubkey, type ScenarioContext } from './command-scenario'
import { buildReport, summaryLine, writeReport, type CommandReportEntry } from './report'

// Real dispatch seam — see tauri.ts:~306 (`invokeTauri`). Resolved via this
// directory's own vitest.config.ts `@` alias to vendor/buzz-desktop/src.
import { invokeTauri } from '../../../../vendor/buzz-desktop/src/shared/api/tauri'

type ManifestEntry = {
  command: string
  disposition: string | null
  status: 'implemented' | 'pending' | 'removed-pending' | 'unclassified'
}

type Manifest = { entries: ManifestEntry[] }

function loadManifest(): Manifest {
  const manifestPath = path.resolve(__dirname, '../command-manifest.json')
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
}

/** Node's schnorr secp256k1 pubkey/privkey for the harness's own identity. */
async function makeIdentityKeypair(): Promise<{ privateKeyHex: string; pubkeyHex: string }> {
  const { schnorr } = await import('@noble/curves/secp256k1')
  const secretKey = schnorr.utils.randomSecretKey()
  const pubkey = schnorr.getPublicKey(secretKey)
  return {
    privateKeyHex: Buffer.from(secretKey).toString('hex'),
    pubkeyHex: Buffer.from(pubkey).toString('hex')
  }
}

class InMemoryLocalStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Known, justified reasons a currently-`implemented` command does not (and,
 * absent further wiring, structurally cannot) verify PASS under this
 * headless harness — as opposed to a real product regression. See
 * runtime-bridge-harness.ts's `makeUnconfiguredRuntimeStub` doc for why
 * `discover_acp_providers` specifically cannot be driven for real here.
 * Anything NOT in this map that fails is treated as a genuine finding and
 * fails the install-gate assertion below — most notably `open_dm`, which
 * this harness found actually fails for a real product reason (see LIMITS
 * in the harness's returned report), not a harness limitation, and is
 * therefore deliberately NOT in this map.
 */
const KNOWN_HARNESS_LIMITATIONS: Record<string, string> = {
  discover_acp_providers:
    'requires runtime.refreshAccountsForMobile()/getAccountsSnapshot(), which are only wired up by ' +
    'the real app calling runtime.configureAccountServices(...) during Electron startup and would ' +
    'spawn real claude/codex CLI probes if replicated headlessly — out of scope for this harness.',
  // Same structural reason as discover_acp_providers above — reported by
  // build-agent-lifecycle: calls accounts.selectClaude/selectCodex, whose
  // handlers need DobiusRuntimeService.selectClaudeAccount/selectCodexAccount,
  // only wired up during real Electron startup.
  connect_acp_runtime:
    'calls accounts.selectClaude/selectCodex, whose handlers need ' +
    'runtime.selectClaudeAccount/selectCodexAccount — only wired up by the real app calling ' +
    'runtime.configureAccountServices(...) during Electron startup, same reason as discover_acp_providers.',
  // These three always throw a real (non-"not implemented") Error by
  // design — reported by build-agent-lifecycle. classify.ts now supports an
  // `expectedError` fixture (see its doc comment) that would let a real
  // scenario step verify PASS against the exact expected rejection instead
  // of living here permanently; not added to agents.scenarios.ts by the
  // harness itself (family file, out of this project's write scope) — this
  // entry is the immediate fix until that lands, and should be REMOVED once
  // it does (a scenario using `expectedError` for these would then set
  // fixtureSource: 'scenario' and verdict: 'PASS' on its own).
  install_acp_runtime:
    'Dobius has no external-runtime installer by design (bundles both engines, connects accounts ' +
    'via Settings login) — this command deliberately rejects every call.',
  put_managed_agent_runtime_lifecycle:
    'pairs with the already-no-op\'d ACP-runtime registry (list_managed_agent_runtimes returns [] ' +
    'in existing code) — Dobius has no separate relay-mesh runtime process to set a lifecycle on, ' +
    'so this deliberately rejects every call.',
  reconcile_inbound_persona_event:
    'Dobius agents are local-only records; nothing publishes the NIP-33 persona projection events ' +
    'this would reconcile, so this deliberately rejects every call.'
}

async function invoke(command: string, args: unknown): Promise<InvokeOutcome> {
  try {
    const result = await invokeTauri<unknown>(command, args as Record<string, unknown> | undefined)
    return { threw: false, result }
  } catch (error) {
    return { threw: true, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Method-seam invocation: through the REAL communications gateway handler
 * (sender-trust check, request validation, COMMUNICATIONS_RUNTIME_METHODS
 * allowlist, dispatcher) — see runtime-bridge-harness.ts's
 * createGatewayMethodInvoker. `command` is the RPC METHOD name. A missing
 * allowlist entry surfaces here as a thrown 'Unsupported command: …', which
 * classifies as ERROR — deliberately loud, unlike the vendor seam's
 * UNIMPLEMENTED.
 */
async function invokeViaGateway(
  gatewayInvoke: (command: string, args?: unknown) => Promise<{ ok: true; result: unknown } | { ok: false; error: { code: string; message: string } }>,
  command: string,
  args: unknown
): Promise<InvokeOutcome> {
  try {
    const response = await gatewayInvoke(command, args)
    if (response.ok) {
      return { threw: false, result: response.result }
    }
    return { threw: true, message: response.error.message }
  } catch (error) {
    return { threw: true, message: error instanceof Error ? error.message : String(error) }
  }
}

describe('communications command verification', () => {
  let relay: RelayHarness
  let manifest: Manifest
  let entries: CommandReportEntry[]
  // Method-seam entries (steps with via:'method'), kept OUT of `entries` so
  // the manifest-coverage tests — which count VENDOR-seam verdicts for all
  // 258 manifest command names — stay exact. See the method-seam `it` blocks
  // below for the (stricter) bar these steps must clear.
  let methodEntries: CommandReportEntry[]

  beforeAll(async () => {
    relay = await startVerificationRelay()
    manifest = loadManifest()

    // The gateway's sender-trust check reads ELECTRON_RENDERER_URL at call
    // time in dev-mode; point it at the method seam's synthetic origin so the
    // REAL check (not a mock) accepts the harness's sender URL.
    process.env.ELECTRON_RENDERER_URL = METHOD_SEAM_RENDERER_URL
    const { invoke: gatewayInvoke } = createGatewayMethodInvoker()

    const identity = await makeIdentityKeypair()
    const localStorage = new InMemoryLocalStorage()
    localStorage.setItem(
      'dobius-buzz-identity.v1',
      JSON.stringify({
        privateKey: identity.privateKeyHex,
        pubkey: identity.pubkeyHex,
        username: 'Verification Harness'
      })
    )

    ;(globalThis as unknown as { window: Record<string, unknown> }).window = {
      localStorage,
      dobiusCommunications: createRuntimeBridge(),
      // dobiusCommunications.ts's delay() calls `window.setTimeout` explicitly
      // (not the bare global), so the fake window needs its own reference.
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args)
    }

    entries = []
    methodEntries = []
    const byCommand = new Map(manifest.entries.map((entry) => [entry.command, entry]))
    const ctx: ScenarioContext = {
      selfPubkey: identity.pubkeyHex,
      otherPubkey: randomHexPubkey(),
      family: {}
    }

    // Pass 1: the ordered, stateful scenario (core + any landed family
    // modules — see command-scenario.ts's composer). fixtureSource:
    // 'scenario' — a hand-built, source-verified fixture, so an ERROR here
    // is a genuine finding, not an artifact of an empty args object.
    for (const step of SCENARIO) {
      const manifestEntry = byCommand.get(step.command)
      const manifestStatus = manifestEntry?.status ?? 'unclassified'
      const disposition = manifestEntry?.disposition ?? null

      if (disposition === 'relay' && !relay.available) {
        entries.push({
          command: step.command,
          manifestStatus,
          disposition,
          fixtureSource: 'scenario',
          ...skipped(relay.reason)
        })
        continue
      }

      // Everything about running ONE step (the second-boundary wait, building
      // its args, dispatching, classifying, capturing) is wrapped in its own
      // try/catch. Why: SCENARIO now interleaves CORE_TEARDOWN_STEPS after
      // every family's steps (see command-scenario.ts's ORDERING doc) — a
      // family fixture that throws while merely BUILDING its args (e.g. a
      // bad assumption about `ctx` shape, before `invoke()`'s own try/catch
      // would ever run) must not abort this whole loop, or teardown
      // (delete_persona/delete_channel) never runs and leaves a dirty world
      // for every step after the one that failed — a worse outcome than one
      // extra ERROR entry.
      try {
        if (step.requiresSecondBoundary) {
          // See ScenarioStep.requiresSecondBoundary's doc in command-scenario.ts.
          await sleep(1100)
        }
        const isMethodSeam = step.via === 'method'
        const outcome = isMethodSeam
          ? await invokeViaGateway(gatewayInvoke, step.command, step.args(ctx))
          : await invoke(step.command, step.args(ctx))
        const classified = classifyOutcome(
          outcome,
          (result) => step.shapeCheck(result, ctx),
          step.expectedError ? { expectedError: step.expectedError } : undefined
        )
        if (classified.verdict === 'PASS' && !outcome.threw && step.capture) {
          step.capture(outcome.result, ctx)
        }
        const entry = {
          command: step.command,
          manifestStatus,
          disposition,
          fixtureSource: 'scenario' as const,
          ...classified
        }
        if (isMethodSeam) {
          methodEntries.push(entry)
        } else {
          entries.push(entry)
        }
      } catch (error) {
        const entry = {
          command: step.command,
          manifestStatus,
          disposition,
          fixtureSource: 'scenario',
          verdict: 'ERROR' as const,
          detail: `fixture itself threw (not the dispatched command): ${error instanceof Error ? error.message : String(error)}`
        }
        if (step.via === 'method') {
          methodEntries.push(entry)
        } else {
          entries.push(entry)
        }
      }
    }

    // Pass 2: everything else — no scenario exists for these yet. Dispatched
    // with `{}`: safe for a genuinely unimplemented command (see
    // command-scenario.ts's module doc — the switch in
    // dobiusCommunications.ts dispatches on command name alone), but an
    // ERROR here is ambiguous rather than a genuine finding — it may mean
    // the command really is broken, or it may mean a real implementation
    // landed and correctly rejected the empty fixture's missing required
    // fields. fixtureSource: 'empty-fallback' flags that ambiguity in the
    // report instead of silently conflating it with a Pass-1 finding.
    for (const entry of manifest.entries) {
      if (SCENARIO_COMMANDS.has(entry.command)) {continue}

      if (entry.disposition === 'removed') {
        entries.push({
          command: entry.command,
          manifestStatus: entry.status,
          disposition: entry.disposition,
          fixtureSource: 'empty-fallback',
          ...skipped(
            'classified removed-pending: scheduled for removal from the Buzz surface, not a verification target'
          )
        })
        continue
      }

      const outcome = await invoke(entry.command, {})
      entries.push({
        command: entry.command,
        manifestStatus: entry.status,
        disposition: entry.disposition,
        fixtureSource: 'empty-fallback',
        ...classifyOutcome(outcome)
      })
    }
  })

  afterAll(async () => {
    await stopVerificationRelay(relay)
    delete process.env.ELECTRON_RENDERER_URL
  })

  it('every manifest command was verified exactly once', () => {
    expect(entries).toHaveLength(manifest.entries.length)
    const seen = new Set(entries.map((entry) => entry.command))
    expect(seen.size).toBe(entries.length)
  })

  it('writes the JSON report and prints the summary', () => {
    const report = buildReport(entries, {
      available: relay.available,
      reason: relay.available ? undefined : relay.reason
    })
    writeReport(report, path.resolve(__dirname, 'reports/latest.json'))
    // eslint-disable-next-line no-console -- the human-readable summary line requirement 3 asks for
    console.log(summaryLine(report))
    expect(report.totalCommands).toBe(manifest.entries.length)
  })

  it('no command the manifest marks implemented regressed (install-gate)', () => {
    const report = buildReport(entries, {
      available: relay.available,
      reason: relay.available ? undefined : relay.reason
    })
    const unexplained = report.regressed.filter((command) => !(command in KNOWN_HARNESS_LIMITATIONS))
    const detail = unexplained
      .map((command) => entries.find((entry) => entry.command === command))
      .map((entry) => `${entry?.command}: ${entry?.verdict}${entry?.detail ? ` (${entry.detail})` : ''}`)
      .join('\n')
    expect(unexplained, detail ? `Regressions:\n${detail}` : undefined).toEqual([])
  })

  it('every method-seam scenario step produced exactly one verdict', () => {
    const methodSteps = SCENARIO.filter((step) => step.via === 'method')
    expect(methodEntries).toHaveLength(methodSteps.length)
    const seen = new Set(methodEntries.map((entry) => entry.command))
    expect(seen.size).toBe(methodEntries.length)
  })

  it('every method-seam step PASSes over the real gateway (install-gate)', () => {
    // Stricter than the vendor seam's install-gate: these steps exercise
    // methods Dobius's own client depends on, through the real gateway
    // pipeline (trust check + allowlist + dispatcher), with hand-built
    // fixtures. There is no KNOWN_HARNESS_LIMITATIONS escape hatch here —
    // a step that cannot deterministically PASS headless does not belong
    // in SCENARIO with via:'method'.
    const failures = methodEntries.filter((entry) => entry.verdict !== 'PASS')
    const detail = failures
      .map((entry) => `${entry.command}: ${entry.verdict}${entry.detail ? ` (${entry.detail})` : ''}`)
      .join('\n')
    expect(failures, detail ? `Method-seam non-PASS:\n${detail}` : undefined).toEqual([])
  })
})
