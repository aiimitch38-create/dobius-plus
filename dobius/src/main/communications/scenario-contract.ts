/**
 * The verification harness's scenario contract — shared between the harness
 * (src/main/communications/verify/) and every feature family's
 * `<family>.scenarios.ts` module (chat/, identity/, native/, huddles/,
 * agents/, canvas/, workstation/, workflows/, and teams.scenarios.ts, which
 * sits directly in this directory).
 *
 * Lives HERE, outside verify/, on purpose: config/tsconfig.node.json (the
 * Node/Electron main project every family file is typechecked under)
 * deliberately EXCLUDES src/main/communications/verify/ — that exclusion is
 * what lets verify/ import the vendored Buzz renderer tree (see
 * verify/tsconfig.json's own doc comment) without dragging that huge tree
 * into the main project. But it also means ANY file inside the main project
 * that imports something from verify/ hits TS6307 ("not listed within the
 * file list of project ..."), which is exactly what every family scenario
 * module needs to do to use this contract — first hit for real by
 * huddles.scenarios.ts. Moving the shared TYPES and PURE HELPERS to this
 * unexcluded location removes the boundary crossing entirely: both the
 * harness and every family live on the same side of it.
 *
 * verify/command-scenario.ts re-exports everything below unchanged, so
 * nothing that already imports from '../verify/command-scenario' (teams,
 * huddles as originally written) breaks at the JS/runtime level — Node and
 * Vitest resolve that import fine regardless of tsc project boundaries.
 * NEW family modules should import from here directly
 * ('../scenario-contract', or './scenario-contract' for a file that sits
 * directly in src/main/communications/ like teams.scenarios.ts does) so
 * `config/tsconfig.node.json` typechecks them without TS6307.
 */
import { schnorr } from '@noble/curves/secp256k1'

export type ShapeOutcome = { ok: true } | { ok: false; reason: string }

export type ScenarioContext = {
  selfPubkey: string
  otherPubkey: string
  personaId?: string
  managedAgentPubkey?: string
  channelId?: string
  eventId?: string
  teamId?: string
  /**
   * Open bag for family-captured state that doesn't warrant its own named
   * field yet (a huddle id, a workflow id, a canvas id, ...). Family
   * modules may read/write any key here without this type needing to
   * change for every new family. Promote a key to a concrete named field
   * above only once more than one family needs to agree on its shape.
   */
  family: Record<string, unknown>
}

export type ScenarioStep = {
  command: string
  args: (ctx: ScenarioContext) => unknown
  /**
   * Which dispatch seam runs this step. 'vendor' (default) goes through the
   * vendored Buzz client's Tauri-command switch (invokeTauri) — the seam the
   * vendored UI uses. 'method' goes through the REAL communications gateway
   * handler (sender-trust check + request validation + allowlist +
   * dispatcher) with the RPC method name — the seam Dobius's own client
   * uses. Methods the vendor switch has no case for can only be exercised
   * with 'method'; a missing allowlist entry there surfaces as ERROR, not
   * the vendor seam's UNIMPLEMENTED.
   */
  via?: 'vendor' | 'method'
  /**
   * Runs only when the command did not throw. Required even on a step that
   * also sets `expectedError` (which never reaches this in practice, since
   * such a command always throws) — kept required rather than optional so
   * every existing family test file that calls `step.shapeCheck(...)`
   * directly (teams.scenarios.test.ts, agents.scenarios.test.ts) keeps
   * typechecking without a null-guard this contract would otherwise force
   * onto every caller. A step using `expectedError` can satisfy this with a
   * trivial `() => ok()`.
   */
  shapeCheck: (result: unknown, ctx: ScenarioContext) => ShapeOutcome
  /** Mutates ctx from a result that already passed shapeCheck. */
  capture?: (result: unknown, ctx: ScenarioContext) => void
  /**
   * For a command whose CORRECT, PERMANENT behavior is to always reject
   * every call (e.g. "Dobius has no external-runtime installer by design") —
   * without this, such a command can never verify PASS under any fixture,
   * since every non-"not implemented" throw is otherwise unconditionally
   * ERROR. See classify.ts's `classifyOutcome` `options.expectedError` doc
   * for the full contract (message must match, or it's ERROR; command must
   * still actually throw, or it's SHAPE_FAIL).
   */
  expectedError?: (message: string) => boolean
  /**
   * True for steps that publish a NIP-33 addressable channel-metadata
   * (kind 39000) or channel-membership (kind 39002) event onto a channel a
   * PRIOR scenario step already wrote the same kind onto. RelayStore's tie
   * break for two addressable events landing in the same wall-clock second
   * (created_at has 1-second resolution) is `event.id` lexicographic order —
   * see relay-store.ts's `supersedes()` — which is not necessarily the one
   * that ran second. The runner waits for a fresh second before these steps
   * so the real, intended write always wins on `created_at` instead.
   */
  requiresSecondBoundary?: boolean
}

// Shared helpers, exported so family modules can build consistent shape
// checks instead of re-inventing them. Deliberately `function` declarations,
// not `const () =>` arrows: several files in this contract's dependency web
// import from each other in a cycle (a family module -> this file for
// types/helpers; verify/command-scenario.ts -> that family module for its
// SCENARIO_STEPS), and hoisted function declarations stay safely accessible
// mid-evaluation of a circular ES module graph, whereas a `const` arrow
// would still be in its temporal dead zone at that point.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasStringField(value: unknown, field: string): boolean {
  return isRecord(value) && typeof value[field] === 'string' && value[field].length > 0
}

export function ok(): ShapeOutcome {
  return { ok: true }
}

export function fail(reason: string): ShapeOutcome {
  return { ok: false, reason }
}

export function expectUndefined(result: unknown): ShapeOutcome {
  return result === undefined ? ok() : fail(`expected undefined, got ${JSON.stringify(result)}`)
}

export function expectArray(result: unknown): ShapeOutcome {
  return Array.isArray(result) ? ok() : fail(`expected an array, got ${typeof result}`)
}

/**
 * A random x-only pubkey that is a REAL point on secp256k1.
 *
 * `randomBytes(32)` is not good enough: only about half of all 32-byte
 * values are valid x-coordinates, so any step that actually does curve
 * maths with the result (NIP-44 encryption in
 * `build_observer_control_event`) failed with "bad point: is not on curve"
 * on roughly half of runs — a fixture flake that read as an intermittent
 * product bug. Deriving from a private key makes it valid every time.
 */
export function randomHexPubkey(): string {
  return Buffer.from(schnorr.getPublicKey(schnorr.utils.randomPrivateKey())).toString('hex')
}
