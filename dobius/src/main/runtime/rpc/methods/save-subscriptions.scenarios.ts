/**
 * Method-seam scenario fixtures for the save-subscription family's five RPC
 * methods (./save-subscriptions.ts), spliced into the verification harness's
 * composable registry by src/main/communications/verify/command-scenario.ts.
 *
 * Every step dispatches through the REAL communications gateway (via:
 * 'method') under its RPC method name — this family has no vendor
 * invokeTauri switch case, so 'method' is the only seam that reaches it,
 * and the harness's method-seam install-gate has no escape hatch: each step
 * must deterministically PASS headless.
 *
 * Lifecycle — all five steps drive ONE row, the caller's own owner_p
 * subscription, because save-subscription-record.ts's ownerSubscriptionKey()
 * pins mergeKind/removeKind to exactly that row (scopeType 'owner_p',
 * scopeValue = identityPubkey); creating any other row would leave the kind
 * mutations operating on a row this family never created:
 *
 *   create (request kinds are unsorted + duplicated; normalizeKinds makes
 *           them [1000, 30023])
 *     → list (row present with the normalized kinds)
 *     → mergeKind (append 24200 → [1000, 24200, 30023])
 *     → removeKind (take the 24200 back out → [1000, 30023])
 *     → delete (removed: true — this IS the cleanup, so runs stay
 *       order-independent; the store also upserts on repeat creates).
 *
 * Why no trailing "assert absence" list step: each command name may appear
 * exactly once across the composed SCENARIO array (run-verification.test.ts
 * fails on duplicates), so saveSubscription.list cannot run twice; absence
 * after teardown is pinned by delete's `removed: true` oracle plus
 * removeKind's surviving-row oracle instead.
 *
 * Keying: a subscription has NO generated id — it is identified by the
 * composite (identityPubkey, relayUrl, scopeType, scopeValue) key (see
 * save-subscription-record.ts's subscriptionKey()), so that key's variable
 * parts are what create captures into ctx.family and every later step
 * addresses the row through.
 *
 * Isolation: the relay URL below is a dedicated .invalid constant, so this
 * family's rows can never collide with rows another family (or production)
 * writes at ws://localhost:3300, and the ctx.family captures stay ours
 * alone. Persistence lands in save-subscriptions.json under the harness's
 * isolated scratch userData (runtime-bridge-harness.ts), never the real
 * profile — no manual file cleanup wanted or done here.
 */
import {
  fail,
  isRecord,
  ok,
  type ScenarioContext,
  type ScenarioStep,
  type ShapeOutcome
} from '../../../communications/scenario-contract'

// Dedicated key-isolation relay + the row mergeKind/removeKind always target.
const RELAY_URL = 'ws://save-subscriptions.scenario.invalid'
const SCOPE_TYPE = 'owner_p'
const MERGED_KIND = 24200
// What create's normalizeKinds() must turn the unsorted, duplicated request
// kinds [30023, 1000, 1000] into — hardcoded, not re-derived with the same
// algorithm the store runs, so a normalization regression cannot pass here.
const CREATED_KINDS = [1000, 30023]

function kindsEqual(actual: unknown, expected: readonly number[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((kind, index) => actual[index] === kind)
  )
}

function expectSubscriptionRow(row: unknown, ctx: ScenarioContext, expectedKinds: readonly number[]): ShapeOutcome {
  if (!isRecord(row)) {
    return fail(`expected a subscription object, got ${JSON.stringify(row)}`)
  }
  if (row.identityPubkey !== ctx.selfPubkey) {
    return fail(`expected identityPubkey ${ctx.selfPubkey}, got ${JSON.stringify(row.identityPubkey)}`)
  }
  if (row.relayUrl !== ctx.family.saveSubRelayUrl || row.scopeType !== SCOPE_TYPE || row.scopeValue !== ctx.family.saveSubScopeValue) {
    return fail(
      `expected this family's (${SCOPE_TYPE}, ${String(ctx.family.saveSubScopeValue)}) row at ${String(ctx.family.saveSubRelayUrl)}, got ${JSON.stringify(row)}`
    )
  }
  if (!kindsEqual(row.kinds, expectedKinds)) {
    return fail(`expected kinds ${JSON.stringify(expectedKinds)}, got ${JSON.stringify(row.kinds)}`)
  }
  return typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
    ? ok()
    : fail(`expected a finite numeric createdAt, got ${JSON.stringify(row.createdAt)}`)
}

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    command: 'saveSubscription.create',
    via: 'method',
    // scopeValue = selfPubkey so the created row IS ownerSubscriptionKey()'s
    // target — the very row the kind mutations below address.
    args: (ctx) => {
      // Why set the family keys HERE and not only in capture: this step's own
      // shapeCheck reads them, and capture only runs after shapeCheck passes —
      // on the create step they must already exist.
      ctx.family.saveSubRelayUrl = RELAY_URL
      ctx.family.saveSubScopeType = SCOPE_TYPE
      ctx.family.saveSubScopeValue = ctx.selfPubkey
      return {
        identityPubkey: ctx.selfPubkey,
        relayUrl: RELAY_URL,
        scopeType: SCOPE_TYPE,
        scopeValue: ctx.selfPubkey,
        kinds: [30023, 1000, 1000]
      }
    },
    shapeCheck: (r, ctx) =>
      isRecord(r)
        ? expectSubscriptionRow(r.subscription, ctx, CREATED_KINDS)
        : fail(`expected { subscription }, got ${JSON.stringify(r)}`),
    // Captures the composite subscription key (this family has no generated
    // id — see this file's keying note).
    capture: (r, ctx) => {
      if (!isRecord(r)) {return}
      ctx.family.saveSubRelayUrl = RELAY_URL
      ctx.family.saveSubScopeType = SCOPE_TYPE
      ctx.family.saveSubScopeValue = ctx.selfPubkey
    }
  },
  {
    command: 'saveSubscription.list',
    via: 'method',
    args: (ctx) => ({ identityPubkey: ctx.selfPubkey, relayUrl: ctx.family.saveSubRelayUrl }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !Array.isArray(r.subscriptions)) {
        return fail(`expected { subscriptions: [...] }, got ${JSON.stringify(r)}`)
      }
      const match = r.subscriptions.find(
        (row) => isRecord(row) && row.scopeType === ctx.family.saveSubScopeType && row.scopeValue === ctx.family.saveSubScopeValue
      )
      return match
        ? expectSubscriptionRow(match, ctx, CREATED_KINDS)
        : fail(`created subscription missing from the list: ${JSON.stringify(r.subscriptions)}`)
    }
  },
  {
    command: 'saveSubscription.mergeKind',
    via: 'method',
    // Read-modify-write append onto the owner_p row create just made — the
    // merged kind must land in its sorted position among existing kinds.
    args: (ctx) => ({ identityPubkey: ctx.selfPubkey, relayUrl: ctx.family.saveSubRelayUrl, kind: MERGED_KIND }),
    shapeCheck: (r, ctx) =>
      isRecord(r)
        ? expectSubscriptionRow(r.subscription, ctx, [1000, MERGED_KIND, 30023])
        : fail(`expected { subscription }, got ${JSON.stringify(r)}`)
  },
  {
    command: 'saveSubscription.removeKind',
    via: 'method',
    // Removes only the merged kind; the row must SURVIVE (non-null) because
    // kinds remain — the delete-to-null branch belongs to a row emptied out,
    // which this lifecycle intentionally never produces.
    args: (ctx) => ({ identityPubkey: ctx.selfPubkey, relayUrl: ctx.family.saveSubRelayUrl, kind: MERGED_KIND }),
    shapeCheck: (r, ctx) =>
      isRecord(r)
        ? expectSubscriptionRow(r.subscription, ctx, CREATED_KINDS)
        : fail(`expected { subscription }, got ${JSON.stringify(r)}`)
  },
  {
    command: 'saveSubscription.delete',
    via: 'method',
    args: (ctx) => ({
      identityPubkey: ctx.selfPubkey,
      relayUrl: ctx.family.saveSubRelayUrl,
      scopeType: SCOPE_TYPE,
      scopeValue: ctx.family.saveSubScopeValue
    }),
    // removed: true both verifies the deletion and guarantees the teardown —
    // a later run starts from a clean slate regardless of step order.
    shapeCheck: (r) =>
      isRecord(r) && r.removed === true
        ? ok()
        : fail(`expected { removed: true } (this delete is also the family cleanup), got ${JSON.stringify(r)}`)
  }
]
