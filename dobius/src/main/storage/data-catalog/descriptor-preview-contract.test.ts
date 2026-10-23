import { describe, expect, it } from 'vitest'
import {
  parseNativePreviewChunk,
  parseNativePreviewIdentity,
  parseNativePreviewStat,
  previewFileVersion,
  type NativePreviewIdentity
} from './descriptor-preview-contract'
import type { CatalogRootIdentity } from './types'

const rootIdentity: CatalogRootIdentity = {
  dev: '1',
  ino: '2',
  incarnation: {
    provider: 'linux-inode-generation-v1',
    scope: '0123456789abcdef',
    token: '3'
  }
}
const identity: NativePreviewIdentity = {
  dev: '18446744073709551615',
  ino: '18446744073709551614',
  sizeBytes: '16384',
  mtimeNs: '18446744073709551613',
  ctimeNs: '18446744073709551612',
  fileType: 'regular'
}

describe('descriptor preview contract', () => {
  it('preserves full-width fields as canonical decimal strings and rejects overflow', () => {
    expect(parseNativePreviewIdentity(identity)).toEqual(identity)
    expect(() => parseNativePreviewIdentity({ ...identity, mtimeNs: '01' })).toThrow()
    expect(() => parseNativePreviewIdentity({ ...identity, dev: '18446744073709551616' })).toThrow()
    expect(parseNativePreviewIdentity({ ...identity, sizeBytes: '262145' }).sizeBytes).toBe(
      '262145'
    )
    expect(() =>
      parseNativePreviewStat({
        ...identity,
        sizeBytes: '262145',
        fileVersion: 'a'.repeat(64)
      })
    ).toThrow()
  })

  it('binds the stat token to authority, exact component spelling, and full-width stat', () => {
    const base = previewFileVersion(
      'root:x',
      'generation:1',
      rootIdentity,
      ['café', 'a\\b.txt'],
      identity
    )
    expect(base).toBe('a65e837891f1346a253123567fc35a67d04994cca3c570321971d290ac51bad3')
    expect(
      previewFileVersion('root:x', 'generation:2', rootIdentity, ['café', 'a\\b.txt'], identity)
    ).not.toBe(base)
    expect(
      previewFileVersion('root:x', 'generation:1', rootIdentity, ['café', 'a\\b.txt'], identity)
    ).not.toBe(base)
    expect(
      previewFileVersion('root:x', 'generation:1', rootIdentity, ['café', 'a\\b.txt'], {
        ...identity,
        mtimeNs: '18446744073709551611'
      })
    ).not.toBe(base)
    expect(
      previewFileVersion(
        'root:x',
        'generation:1',
        {
          ...rootIdentity,
          birthtimeNs: '90071992547409931234'
        },
        ['café', 'a\\b.txt'],
        identity
      )
    ).toBe(base)
  })

  it('accepts only canonical stat and base64 chunk envelopes', () => {
    const stat = parseNativePreviewStat({
      ...identity,
      fileVersion: 'a'.repeat(64)
    })
    expect(stat.fileVersion).toBe('a'.repeat(64))
    expect(
      parseNativePreviewChunk({
        stat,
        dataBase64: Buffer.from('abc').toString('base64'),
        offset: 0,
        nextOffset: 3,
        final: false
      })
    ).toMatchObject({ offset: 0, nextOffset: 3, final: false })
    expect(() => parseNativePreviewStat({ ...stat, unexpected: true })).toThrow()
    expect(() =>
      parseNativePreviewChunk({
        stat,
        dataBase64: 'YQ==junk',
        offset: 0,
        nextOffset: 1,
        final: false
      })
    ).toThrow()
    expect(() =>
      parseNativePreviewChunk({
        stat,
        dataBase64: 'YQ==',
        offset: 1,
        nextOffset: 3,
        final: false
      })
    ).toThrow()
  })
})
