/**
 * Scoped Vitest config for the communications command verification harness.
 *
 * Why a separate config instead of running under the repo's own
 * config/vitest.config.ts: this harness imports the vendored Buzz renderer
 * code directly (vendor/buzz-desktop/src/shared/api/tauri.ts — the real
 * dispatch seam, per the harness's brief) to drive commands through
 * production dispatch rather than a mock. That vendored code resolves its
 * own `@/...` imports against vendor/buzz-desktop/src (see its own
 * tsconfig.json `"@/*": ["./src/*"]`), but the repo's root config already
 * aliases `@` to `src/renderer/src` for the main app — a different target.
 * Overriding that alias in the shared config would be an edit outside this
 * harness's owned `verify/` directory, so it gets its own config instead.
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const repoRoot = resolve(__dirname, '../../../..')

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(repoRoot, 'vendor/buzz-desktop/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/main/communications/verify/**/*.test.ts'],
    // Why generous timeouts: unlike most unit tests, run-verification.test.ts
    // does real network I/O (an in-process HTTP relay) and real RPC dispatch
    // across all 258 commands in one test.
    // Why generous: the scenario also sleeps ~1.1s before ~11 addressable-
    // event steps to dodge the relay's 1-second created_at tie-break (see
    // ScenarioStep.requiresSecondBoundary in command-scenario.ts).
    hookTimeout: 120_000,
    testTimeout: 120_000,
    // Why: run-verification.test.ts and auth-handshake-integration.test.ts
    // both bind the relay's real, hardcoded port (127.0.0.1:3300 — the
    // vendored Buzz client hardcodes that origin, so tests can't just pick a
    // free one; see relay-test-harness.ts's module doc). Vitest's default
    // file parallelism runs test files in separate worker processes, so
    // both would race to bind 3300: whichever loses hits the port-in-use
    // guard and refuses to run rather than touch what might be another
    // process's relay (correct, safe behavior) — but that made a bare
    // `vitest run` over this directory non-deterministic depending on which
    // file's beforeAll won the race. Sequential file execution removes the
    // race entirely.
    fileParallelism: false
  }
})
