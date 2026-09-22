import { describe, expect, it } from 'vitest'
import { resolveDobiusDevEnvironmentUrl } from './dobius-dev-environment-url'

describe('resolveDobiusDevEnvironmentUrl', () => {
  it('uses the current renderer dev server origin when available', () => {
    expect(
      resolveDobiusDevEnvironmentUrl({
        protocol: 'http:',
        host: '127.0.0.1:52241'
      })
    ).toBe('http://127.0.0.1:52241/')
  })

  it('falls back to the default Vite port outside an HTTP renderer session', () => {
    expect(
      resolveDobiusDevEnvironmentUrl({
        protocol: 'file:',
        host: ''
      })
    ).toBe('http://localhost:5173/')
  })
})
