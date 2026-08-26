/**
 * The communications command verification harness (post-vendor).
 *
 * Drives every scenario step through a REAL seam against a REAL in-process
 * relay and a REAL RpcDispatcher — never a mock — and records one of: PASS,
 * UNIMPLEMENTED, SHAPE_FAIL, ERROR, SKIPPED. Two seams:
 *
 * - via:'method' steps dispatch RPC method names through the REAL gateway
 *   pipeline (createCommunicationsBridgeHandler: sender-trust check, request
 *   validation, allowlist, dispatcher) — the path Dobius's own client uses.
 * - direct steps call in-process world helpers (verify/relay-world-ops.ts)
 *   for relay-protocol operations (channel/message/profile event publishing)
 *   that have no RPC method behind them.
 *
 * The former third seam — the vendored Buzz client's invokeTauri switch —
 * retired with vendor/buzz-desktop. See classify.ts for verdict rules,
 * command-scenario.ts for the composer, relay-test-harness.ts and
 * runtime-bridge-harness.ts for how the real backends are stood up, and
 * report.ts for the JSON artifact.
 *
 * Run: npx vitest run --config src/main/communications/verify/vitest.config.ts
 * (from the `dobius` directory — or scripts/run-comms-gate.sh, which frees
 * the relay port from the live app first).
 *
 * This file must import runtime-bridge-harness.ts (which mocks `electron`
 * and os.homedir) before anything else that could transitively import the
 * real modules — see that file's own doc comment for why.
 */
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGatewayMethodInvoker, METHOD_SEAM_RENDERER_URL } from './runtime-bridge-harness'
import { startVerificationRelay, stopVerificationRelay, type RelayHarness } from './relay-test-harness'
import { classifyOutcome, type InvokeOutcome } from './classify'
import { SCENARIO, randomHexPubkey, type ScenarioContext } from './command-scenario'
import { buildReport, summaryLine, writeReport, type CommandReportEntry } from './report'

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Direct-step invocation: calls the step's in-process world helper and wraps
 * the outcome in the same InvokeOutcome shape the dispatch seams produce, so
 * classifyOutcome/shapeCheck/capture treat all seams identically.
 */
async function runDirectStep(
  fn: (ctx: ScenarioContext) => Promise<unknown>,
  ctx: ScenarioContext
): Promise<InvokeOutcome> {
  try {
    return { threw: false, result: await fn(ctx) }
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
  // Direct-step entries (core world: relay-protocol operations with no RPC
  // method behind them). Method-seam entries live in methodEntries. Both
  // arrays are gated to all-PASS below — there is no manifest anymore, so
  // there is no 'implemented' allowlist to be lenient about.
  let entries: CommandReportEntry[]
  let methodEntries: CommandReportEntry[]

  beforeAll(async () => {
    relay = await startVerificationRelay()

    // The gateway's sender-trust check reads ELECTRON_RENDERER_URL at call
    // time in dev-mode; point it at the method seam's synthetic origin so the
    // REAL check (not a mock) accepts the harness's sender URL.
    process.env.ELECTRON_RENDERER_URL = METHOD_SEAM_RENDERER_URL
    const { invoke: gatewayInvoke } = createGatewayMethodInvoker()

    const identity = await makeIdentityKeypair()

    entries = []
    methodEntries = []
    const ctx: ScenarioContext = {
      selfPubkey: identity.pubkeyHex,
      otherPubkey: randomHexPubkey(),
      family: {}
    }

    // The ordered, stateful scenario (core world + family modules — see
    // command-scenario.ts's composer). A hand-built, source-verified fixture
    // per step, so an ERROR here is a genuine finding.
    for (const step of SCENARIO) {
      // Everything about running ONE step (the second-boundary wait, building
      // its args, dispatching, classifying, capturing) is wrapped in its own
      // try/catch. Why: a family fixture that throws while merely BUILDING
      // its args must not abort this whole loop, or teardown never runs and
      // leaves a dirty world for every step after the one that failed — a
      // worse outcome than one extra ERROR entry.
      try {
        if (step.requiresSecondBoundary) {
          // See ScenarioStep.requiresSecondBoundary's doc in command-scenario.ts.
          await sleep(1100)
        }
        const isMethodSeam = step.via === 'method'
        const outcome = step.direct
          ? await runDirectStep(step.direct, ctx)
          : isMethodSeam
            ? await invokeViaGateway(gatewayInvoke, step.command, step.args(ctx))
            : await runDirectStep(async () => {
                throw new Error(
                  `step '${step.command}' has neither direct nor via:'method' — the vendor seam is retired`
                )
              }, ctx)
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
          manifestStatus: 'unclassified' as const,
          disposition: null,
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
          manifestStatus: 'unclassified' as const,
          disposition: null,
          fixtureSource: 'scenario' as const,
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
  })

  afterAll(async () => {
    await stopVerificationRelay(relay)
    delete process.env.ELECTRON_RENDERER_URL
  })

  it('every scenario step produced exactly one verdict', () => {
    expect(entries.length + methodEntries.length).toBe(SCENARIO.length)
    const seen = new Set([...entries, ...methodEntries].map((entry) => entry.command))
    expect(seen.size).toBe(SCENARIO.length)
  })

  it('writes the JSON report and prints the summary', () => {
    const report = buildReport([...entries, ...methodEntries], {
      available: relay.available,
      reason: relay.available ? undefined : relay.reason
    })
    writeReport(report, path.resolve(__dirname, 'reports/latest.json'))
    // eslint-disable-next-line no-console -- the human-readable summary line requirement 3 asks for
    console.log(summaryLine(report))
    expect(report.totalCommands).toBe(SCENARIO.length)
  })

  it('every direct core-world step PASSes (install-gate)', () => {
    // The core world (identity, channels, messages, agents) is the
    // foundation every family builds on — a non-PASS here means the world
    // itself is broken. Same strictness as the method seam: no escape hatch.
    const failures = entries.filter((entry) => entry.verdict !== 'PASS')
    const detail = failures
      .map((entry) => `${entry.command}: ${entry.verdict}${entry.detail ? ` (${entry.detail})` : ''}`)
      .join('\n')
    expect(failures, detail ? `Direct-step non-PASS:\n${detail}` : undefined).toEqual([])
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
