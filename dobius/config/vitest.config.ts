import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { commsAliases } from './comms-alias'

const windowsTestWorkerOptions = process.platform === 'win32' ? { maxWorkers: 4 } : {}

export default defineConfig({
  define: {
    DOBIUS_FEATURE_WALL_ENABLED: 'true'
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src'),
      // Why: the restored Communications tree's own *.test.mjs files import
      // via '@comms/*' (its internal root, separate from '@' so its imports
      // never collide with the rest of the app's) — without this alias here
      // too, those tests can't resolve their own module's dependencies.
      // Why: 355 *.test.mjs files import node's built-in runner but resolve
      // their sources through vitest-only aliases, so neither runner could
      // execute them. The shim re-exports vitest's equivalents.
      'node:test': resolve('config/node-test-shim.mjs'),
      ...commsAliases()
    }
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.test.mjs',
      'config/scripts/**/*.test.mjs',
      'tests/e2e/**/*.unit.test.ts'
    ],
    // Why: the full suite runs heavy TS transforms plus real git/http fixtures;
    // the Vitest 5s defaults are too tight for the slowest integration cases.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Why: Windows process and shell startup are slower under full-suite load;
    // macOS/Linux keep Vitest's default worker parallelism.
    ...windowsTestWorkerOptions
  }
})
