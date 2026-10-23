import { describe, expect, it } from 'vitest'
import { assertSandboxPreloadBundle } from '../../../config/sandbox-preload-bundle'

describe('production sandbox preload dependency gate', () => {
  it('rejects the exact external Zod import that broke packaged preload startup', () => {
    const emittedHeader =
      '"use strict"; const electron = require("electron"); const zod = require("zod");'
    expect(() => assertSandboxPreloadBundle(emittedHeader)).toThrow(
      'unsupported external module: zod'
    )
  })

  it('allows documented sandbox builtins and bundled dependency bodies', () => {
    expect(() =>
      assertSandboxPreloadBundle(
        'const ipc = require("electron"); const events = require("node:events"); function validate(x) { return typeof x === "string"; }'
      )
    ).not.toThrow()
  })

  it.each(['./sibling.js', 'node:fs', '@electron-toolkit/preload'])(
    'refuses external %s before packaging',
    (module) => {
      expect(() =>
        assertSandboxPreloadBundle(`const external = require(${JSON.stringify(module)});`)
      ).toThrow('unsupported external module')
    }
  )

  it.each([
    'require(variable)',
    'import("./sibling.js")',
    'import value from "electron";',
    'export { value } from "./sibling.js";'
  ])('refuses unsupported module loading: %s', (code) => {
    expect(() => assertSandboxPreloadBundle(code)).toThrow('Sandbox preload')
  })

  it.each([
    'const load = require; load("zod")',
    'module.require("zod")',
    'module["require"]("zod")',
    'const load = __require; load("zod")'
  ])('rejects loader aliases and member forms: %s', (code) => {
    expect(() => assertSandboxPreloadBundle(code)).toThrow('Sandbox preload')
  })

  it('ignores import-looking comments and strings instead of rejecting inert data', () => {
    expect(() =>
      assertSandboxPreloadBundle('/* require("zod") */ const text = "require(\\\"zod\\\")";')
    ).not.toThrow()
  })
})
