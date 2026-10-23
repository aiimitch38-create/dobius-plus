import { describe, expect, it } from 'vitest'
import {
  DataCatalogPreviewChunkResultSchema,
  DataCatalogPreviewPolicyRequestSchema,
  DataCatalogPreviewPolicyResultSchema,
  DataCatalogPreviewStartResultSchema,
  DataCatalogSetPreviewAccessRequestSchema
} from './data-catalog-preview-schema'

const rootId = 'catalog:fixture'
const generation = '8de3037a-7171-4399-af40-9e31de2cb59e'
const version = 'a'.repeat(64)
const sessionId = 'f4dcb274-ae03-40a4-90ce-6b625ca4794a'

describe('data catalog preview schemas', () => {
  it('keeps preview policy strict and reports independent local/mobile state', () => {
    expect(
      DataCatalogPreviewPolicyRequestSchema.safeParse({ rootId, generation, path: '/private' })
        .success
    ).toBe(false)
    expect(
      DataCatalogPreviewPolicyResultSchema.parse({
        state: 'local',
        desktopPreviewEnabled: false,
        deviceIds: [],
        devices: []
      })
    ).toMatchObject({ state: 'local', desktopPreviewEnabled: false, deviceIds: [] })
    expect(
      DataCatalogPreviewPolicyResultSchema.safeParse({ state: 'mobile', enabled: true, path: '/' })
        .success
    ).toBe(false)
  })

  it('requires an exact local grant mutation with unique device IDs', () => {
    expect(
      DataCatalogSetPreviewAccessRequestSchema.safeParse({
        rootId,
        desktopPreviewEnabled: true,
        deviceIds: [generation],
        allowedDeviceIds: [generation]
      }).success
    ).toBe(false)
    expect(
      DataCatalogSetPreviewAccessRequestSchema.safeParse({
        rootId,
        desktopPreviewEnabled: true,
        deviceIds: [generation, generation]
      }).success
    ).toBe(false)
  })

  it('bounds bytes without throwing for malformed or oversized decimal input', () => {
    const base = {
      state: 'ready',
      previewSessionId: sessionId,
      rootId,
      generation,
      fileVersion: version,
      chunkBytes: 16_384,
      expiresInMs: 60_000
    }
    expect(
      DataCatalogPreviewStartResultSchema.safeParse({ ...base, totalBytes: '262144' }).success
    ).toBe(true)
    for (const totalBytes of ['abc', '1e3', '', '-1', '00', '99999999999999999', '262145']) {
      expect(() =>
        DataCatalogPreviewStartResultSchema.safeParse({ ...base, totalBytes })
      ).not.toThrow()
      expect(DataCatalogPreviewStartResultSchema.safeParse({ ...base, totalBytes }).success).toBe(
        false
      )
    }
  })

  it('requires canonical bounded base64 and exact response envelope shape', () => {
    const base = {
      state: 'chunk',
      previewSessionId: sessionId,
      rootId,
      generation,
      fileVersion: version,
      totalBytes: '3',
      offset: 0,
      nextOffset: 3,
      final: true
    }
    expect(
      DataCatalogPreviewChunkResultSchema.safeParse({ ...base, dataBase64: 'YWJj' }).success
    ).toBe(true)
    for (const dataBase64 of ['YWJj$', 'YWJj=', 'A===']) {
      expect(DataCatalogPreviewChunkResultSchema.safeParse({ ...base, dataBase64 }).success).toBe(
        false
      )
    }
    expect(
      DataCatalogPreviewChunkResultSchema.safeParse({
        ...base,
        dataBase64: 'YWJj',
        absolutePath: '/'
      }).success
    ).toBe(false)
  })
})
