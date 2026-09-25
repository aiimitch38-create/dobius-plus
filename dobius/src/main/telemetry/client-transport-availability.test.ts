// #122 F11: the Privacy pane's "unavailable" state and `track()` share one
// answer to "can this build send?". Outside an official CI build (vitest,
// `pnpm dev`, this fork's local builds) the answer must be no.

import { afterEach, describe, expect, it } from 'vitest'
import { _enableTransportForTests, isTelemetryTransportAvailable } from './client'

describe('isTelemetryTransportAvailable()', () => {
  afterEach(() => {
    _enableTransportForTests(false)
  })

  it('is false in a non-official build', () => {
    expect(isTelemetryTransportAvailable()).toBe(false)
  })

  it('follows the test transport override', () => {
    _enableTransportForTests(true)
    expect(isTelemetryTransportAvailable()).toBe(true)
  })
})
