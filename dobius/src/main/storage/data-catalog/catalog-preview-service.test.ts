import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  completedSession,
  deviceId,
  fixture,
  prepared
} from './catalog-preview-service-test-fixtures'

async function holdPolicyCapacity(
  f: Awaited<ReturnType<typeof fixture>>,
  target: { rootId: string; generation: string }
) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const original = f.catalog.roots.resolveAuthorizedRoot.bind(f.catalog.roots)
  let entered = 0
  f.catalog.roots.resolveAuthorizedRoot = async (...args) => {
    entered += 1
    await gate
    return original(...args)
  }
  const policyRequest = { rootId: target.rootId, generation: target.generation }
  const pending = Array.from({ length: 16 }, () =>
    f.catalog.previewPolicy(f.principal, policyRequest)
  )
  return { pending, release, entered: () => entered }
}

describe('registered-root preview session facade', () => {
  it('registers only emitted metadata witnesses and reads in ordered chunks after explicit preview', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      expect(f.readCalls).toBe(0)
      const resolved = await f.catalog.previewResolve(f.principal, target)
      expect(resolved).toMatchObject({
        state: 'ready',
        rootId: target.rootId,
        generation: target.generation,
        sizeBytes: '4'
      })
      if (resolved.state !== 'ready') {
        return
      }
      const started = await f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })
      expect(started).toMatchObject({ state: 'ready', totalBytes: '4', chunkBytes: 16_384 })
      if (started.state !== 'ready') {
        return
      }
      expect(f.readCalls).toBe(0)
      const chunk = await f.catalog.previewChunk(f.principal, {
        previewSessionId: started.previewSessionId,
        offset: 0
      })
      expect(chunk).toMatchObject({
        state: 'chunk',
        offset: 0,
        nextOffset: 4,
        final: true,
        dataBase64: 'dGV4dA=='
      })
      expect(chunk).not.toHaveProperty('stat')
      expect(f.readCalls).toBe(1)
      expect(
        await f.catalog.previewFinish(f.principal, {
          previewSessionId: started.previewSessionId,
          fileVersion: started.fileVersion
        })
      ).toEqual({ state: 'visible', leaseTtlMs: 30_000 })
      expect(
        await f.catalog.previewRenew(f.principal, {
          previewSessionId: started.previewSessionId,
          fileVersion: started.fileVersion
        })
      ).toEqual({ state: 'visible', leaseTtlMs: 30_000 })
    } finally {
      await f.catalog.close()
    }
  })

  it('does not create a preview witness when the native listing identity is absent', async () => {
    const f = await fixture({ includeIdentity: false })
    try {
      const target = await prepared(f)
      expect(await f.catalog.previewResolve(f.principal, target)).toEqual({ state: 'expired' })
      expect(f.readCalls).toBe(0)
    } finally {
      await f.catalog.close()
    }
  })

  it('does not create a preview witness when helper incarnation cannot be read synchronously', async () => {
    const f = await fixture({ helperEpochAvailable: false })
    try {
      const target = await prepared(f)
      expect(await f.catalog.previewResolve(f.principal, target)).toEqual({ state: 'unavailable' })
      expect(f.readCalls).toBe(0)
    } finally {
      await f.catalog.close()
    }
  })

  it('returns the consent policy while desktop preview is disabled', async () => {
    const f = await fixture()
    try {
      const root = await f.catalog.chooseRoot('desktop', 'obsidian-vault')
      if (!root) {
        throw new Error('fixture root was not enrolled')
      }
      expect(
        await f.catalog.previewPolicy(f.principal, {
          rootId: root.rootId,
          generation: root.generation
        })
      ).toEqual({
        state: 'local',
        desktopPreviewEnabled: false,
        deviceIds: [],
        devices: [{ deviceId, name: 'Fixture phone' }]
      })
    } finally {
      await f.catalog.close()
    }
  })

  it('does not infer paired-mobile scope when the separate roster omits it', async () => {
    const f = await fixture({ missingMobileScope: true })
    try {
      const root = await f.catalog.chooseRoot('desktop', 'obsidian-vault')
      if (!root) {
        throw new Error('fixture root was not enrolled')
      }
      expect(
        await f.catalog.previewPolicy(f.principal, {
          rootId: root.rootId,
          generation: root.generation
        })
      ).toMatchObject({ state: 'local', devices: [] })
      expect(() =>
        f.catalog.setPreviewAccess('desktop', {
          rootId: root.rootId,
          desktopPreviewEnabled: false,
          deviceIds: [deviceId]
        })
      ).toThrow('no longer paired for mobile preview')
    } finally {
      await f.catalog.close()
    }
  })

  it('reserves policy capacity before authenticated root resolution awaits', async () => {
    const f = await fixture()
    try {
      const root = await f.catalog.chooseRoot('desktop', 'obsidian-vault')
      if (!root) {
        throw new Error('fixture root was not enrolled')
      }
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const original = f.catalog.roots.resolveAuthorizedRoot.bind(f.catalog.roots)
      let entered = 0
      f.catalog.roots.resolveAuthorizedRoot = async (...args) => {
        entered += 1
        await gate
        return original(...args)
      }
      const pending = Array.from({ length: 20 }, () =>
        f.catalog.previewPolicy(f.principal, { rootId: root.rootId, generation: root.generation })
      )
      expect(entered).toBe(16)
      release()
      const results = await Promise.all(pending)
      expect(results.filter((result) => result.state === 'local')).toHaveLength(16)
      expect(results.filter((result) => result.state === 'unavailable')).toHaveLength(4)
    } finally {
      await f.catalog.close()
    }
  })

  it('reserves resolve capacity before its first authenticated await', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      const held = await holdPolicyCapacity(f, target)
      try {
        expect(held.entered()).toBe(16)
        expect(await f.catalog.previewResolve(f.principal, target)).toEqual({ state: 'busy' })
        expect(held.entered()).toBe(16)
      } finally {
        held.release()
      }
      const results = await Promise.all(held.pending)
      expect(results.every((result) => result.state === 'local')).toBe(true)
    } finally {
      await f.catalog.close()
    }
  })

  it('reserves one of four native slots before resolve authorization awaits', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const original = f.catalog.roots.resolveAuthorizedRoot.bind(f.catalog.roots)
      let entered = 0
      f.catalog.roots.resolveAuthorizedRoot = async (...args) => {
        entered += 1
        await gate
        return original(...args)
      }
      const pending = Array.from({ length: 4 }, () => f.catalog.previewResolve(f.principal, target))
      expect(entered).toBe(4)
      expect(await f.catalog.previewResolve(f.principal, target)).toEqual({ state: 'busy' })
      expect(entered).toBe(4)
      release()
      const results = await Promise.all(pending)
      expect(results.every((result) => result.state === 'ready')).toBe(true)
      expect(f.statCalls).toBe(4)
    } finally {
      await f.catalog.close()
    }
  })

  it('rejects resolve when helper epoch changes while openRoot is pending, before verifyRoot', async () => {
    const f = await fixture({ deferOpen: true })
    try {
      const target = await prepared(f)
      const verifyCallsBeforeResolve = f.verifyRootCalls
      const statCallsBeforeResolve = f.statCalls
      f.deferNextOpen()
      const resolving = f.catalog.previewResolve(f.principal, target)
      await f.openEntered
      f.helperEpoch = 2
      f.releaseOpen()
      expect(await resolving).toEqual({ state: 'denied' })
      expect(f.verifyRootCalls).toBe(verifyCallsBeforeResolve)
      expect(f.statCalls).toBe(statCallsBeforeResolve)
    } finally {
      await f.catalog.close()
    }
  })

  it('makes finish a one-time visibility transition before expiry', async () => {
    const f = await fixture()
    try {
      const { started } = await completedSession(f)
      const request = {
        previewSessionId: started.previewSessionId,
        fileVersion: started.fileVersion
      }
      expect(await f.catalog.previewFinish(f.principal, request)).toEqual({
        state: 'visible',
        leaseTtlMs: 30_000
      })
      const statsAtCommit = f.statCalls
      expect(await f.catalog.previewFinish(f.principal, request)).toEqual({ state: 'expired' })
      expect(f.statCalls).toBe(statsAtCommit)
      expect(await f.catalog.previewFinish(f.principal, request)).toEqual({ state: 'expired' })
    } finally {
      await f.catalog.close()
    }
  })

  it('does not reissue finish after a visibility lease expires while the session TTL remains', async () => {
    const f = await fixture()
    try {
      vi.useFakeTimers({ now: new Date('2026-10-14T12:00:00Z') })
      const { started } = await completedSession(f)
      const request = {
        previewSessionId: started.previewSessionId,
        fileVersion: started.fileVersion
      }
      expect((await f.catalog.previewFinish(f.principal, request)).state).toBe('visible')
      vi.advanceTimersByTime(30_001)
      const statsAtExpiry = f.statCalls
      expect(await f.catalog.previewFinish(f.principal, request)).toEqual({ state: 'expired' })
      expect(f.statCalls).toBe(statsAtExpiry)
      expect(await f.catalog.previewFinish(f.principal, request)).toEqual({ state: 'expired' })
    } finally {
      vi.useRealTimers()
      await f.catalog.close()
    }
  })

  it('never revives finish across wall-clock skew or rollback', async () => {
    const f = await fixture()
    try {
      vi.useFakeTimers({ now: new Date('2026-10-14T12:00:00Z') })
      const { started } = await completedSession(f)
      const request = {
        previewSessionId: started.previewSessionId,
        fileVersion: started.fileVersion
      }
      expect((await f.catalog.previewFinish(f.principal, request)).state).toBe('visible')
      vi.setSystemTime(Date.now() + 30_001)
      const statsAfterForwardJump = f.statCalls
      expect(await f.catalog.previewFinish(f.principal, request)).toEqual({ state: 'expired' })
      expect(f.statCalls).toBe(statsAfterForwardJump)
    } finally {
      vi.useRealTimers()
      await f.catalog.close()
    }

    const g = await fixture()
    try {
      vi.useFakeTimers({ now: new Date('2026-10-14T12:00:00Z') })
      const { started } = await completedSession(g)
      const request = {
        previewSessionId: started.previewSessionId,
        fileVersion: started.fileVersion
      }
      expect((await g.catalog.previewFinish(g.principal, request)).state).toBe('visible')
      vi.advanceTimersByTime(30_001)
      vi.setSystemTime(Date.now() - 100_000)
      const statsAfterRollback = g.statCalls
      expect(await g.catalog.previewFinish(g.principal, request)).toEqual({ state: 'expired' })
      expect(g.statCalls).toBe(statsAfterRollback)
    } finally {
      vi.useRealTimers()
      await g.catalog.close()
    }
  })

  it('reserves finish and renew capacity before native stat awaits', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      const resolved = await f.catalog.previewResolve(f.principal, target)
      if (resolved.state !== 'ready') {
        throw new Error('fixture reference unavailable')
      }
      const started = await f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })
      if (started.state !== 'ready') {
        throw new Error('fixture session unavailable')
      }
      const chunk = await f.catalog.previewChunk(f.principal, {
        previewSessionId: started.previewSessionId,
        offset: 0
      })
      expect(chunk.state).toBe('chunk')

      const heldFinish = await holdPolicyCapacity(f, target)
      try {
        const finishStatCount = f.statCalls
        expect(
          await f.catalog.previewFinish(f.principal, {
            previewSessionId: started.previewSessionId,
            fileVersion: started.fileVersion
          })
        ).toEqual({ state: 'busy' })
        expect(heldFinish.entered()).toBe(16)
        expect(f.statCalls).toBe(finishStatCount)
      } finally {
        heldFinish.release()
      }
      await Promise.all(heldFinish.pending)

      const finished = await f.catalog.previewFinish(f.principal, {
        previewSessionId: started.previewSessionId,
        fileVersion: started.fileVersion
      })
      expect(finished.state).toBe('visible')
      const heldRenew = await holdPolicyCapacity(f, target)
      try {
        const renewStatCount = f.statCalls
        expect(
          await f.catalog.previewRenew(f.principal, {
            previewSessionId: started.previewSessionId,
            fileVersion: started.fileVersion
          })
        ).toEqual({ state: 'busy' })
        expect(heldRenew.entered()).toBe(16)
        expect(f.statCalls).toBe(renewStatCount)
      } finally {
        heldRenew.release()
      }
      await Promise.all(heldRenew.pending)
    } finally {
      await f.catalog.close()
    }
  })

  it('rechecks the listed physical stat before minting an entry reference', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      f.changeChildIdentity()
      expect(await f.catalog.previewResolve(f.principal, target)).toEqual({ state: 'changed' })
    } finally {
      await f.catalog.close()
    }
  })

  it('rechecks the authority epoch after an awaited native stat before committing start', async () => {
    const f = await fixture({ deferStat: true })
    try {
      const target = await prepared(f)
      const resolved = await f.catalog.previewResolve(f.principal, target)
      if (resolved.state !== 'ready') {
        throw new Error('fixture ref unavailable')
      }
      f.deferNextStat()
      const starting = f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })
      await f.statEntered
      f.catalog.setPreviewAccess('desktop', {
        rootId: target.rootId,
        desktopPreviewEnabled: false,
        deviceIds: []
      })
      f.releaseStat()
      expect(await starting).toEqual({ state: 'denied' })
      expect(f.readCalls).toBe(0)
    } finally {
      await f.catalog.close()
    }
  })

  it('drains an opened-root operation before catalog disposal completes', async () => {
    const f = await fixture({ deferStat: true })
    try {
      const target = await prepared(f)
      const resolved = await f.catalog.previewResolve(f.principal, target)
      if (resolved.state !== 'ready') {
        throw new Error('fixture ref unavailable')
      }
      f.deferNextStat()
      const starting = f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })
      await f.statEntered
      let closeResolved = false
      const closing = f.catalog.close().then(() => {
        closeResolved = true
      })
      await Promise.resolve()
      expect(closeResolved).toBe(false)
      f.releaseStat()
      expect(await starting).toMatchObject({ state: 'cancelled' })
      await closing
      expect(closeResolved).toBe(true)
    } finally {
      await f.catalog.close()
    }
  })

  it('does not return a chunk when authority is revoked while the opened root is closing', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      const resolved = await f.catalog.previewResolve(f.principal, target)
      if (resolved.state !== 'ready') {
        throw new Error('fixture ref unavailable')
      }
      const started = await f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })
      if (started.state !== 'ready') {
        throw new Error('fixture session unavailable')
      }
      f.deferNextClose()
      const pending = f.catalog.previewChunk(f.principal, {
        previewSessionId: started.previewSessionId,
        offset: 0
      })
      await f.closeEntered
      f.catalog.setPreviewAccess('desktop', {
        rootId: target.rootId,
        desktopPreviewEnabled: false,
        deviceIds: []
      })
      f.releaseClose()
      expect(await pending).toEqual({ state: 'denied' })
      expect(
        await f.catalog.previewChunk(f.principal, {
          previewSessionId: started.previewSessionId,
          offset: 0
        })
      ).toEqual({ state: 'expired' })
    } finally {
      await f.catalog.close()
    }
  })

  it('rechecks native file version before finish and before lease renewal', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      const resolved = await f.catalog.previewResolve(f.principal, target)
      if (resolved.state !== 'ready') {
        throw new Error('fixture ref unavailable')
      }
      const started = await f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })
      if (started.state !== 'ready') {
        throw new Error('fixture session unavailable')
      }
      const chunk = await f.catalog.previewChunk(f.principal, {
        previewSessionId: started.previewSessionId,
        offset: 0
      })
      expect(chunk.state).toBe('chunk')
      f.changeChildIdentity()
      expect(
        await f.catalog.previewFinish(f.principal, {
          previewSessionId: started.previewSessionId,
          fileVersion: started.fileVersion
        })
      ).toEqual({ state: 'changed' })

      const nextTarget = await prepared(f)
      const nextRef = await f.catalog.previewResolve(f.principal, nextTarget)
      if (nextRef.state !== 'ready') {
        throw new Error('fixture ref unavailable')
      }
      const nextSession = await f.catalog.previewStart(f.principal, { entryRef: nextRef.entryRef })
      if (nextSession.state !== 'ready') {
        throw new Error('fixture session unavailable')
      }
      const final = await f.catalog.previewChunk(f.principal, {
        previewSessionId: nextSession.previewSessionId,
        offset: 0
      })
      expect(final.state).toBe('chunk')
      expect(
        await f.catalog.previewFinish(f.principal, {
          previewSessionId: nextSession.previewSessionId,
          fileVersion: nextSession.fileVersion
        })
      ).toMatchObject({ state: 'visible' })
      f.changeChildIdentity()
      expect(
        await f.catalog.previewRenew(f.principal, {
          previewSessionId: nextSession.previewSessionId,
          fileVersion: nextSession.fileVersion
        })
      ).toEqual({ state: 'changed' })
    } finally {
      await f.catalog.close()
    }
  })

  it('invalidates entry refs when the native helper incarnation changes', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      const resolved = await f.catalog.previewResolve(f.principal, target)
      if (resolved.state !== 'ready') {
        throw new Error('fixture ref unavailable')
      }
      f.helperEpoch = 2
      expect(await f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })).toEqual({
        state: 'expired'
      })
      expect(f.readCalls).toBe(0)
    } finally {
      await f.catalog.close()
    }
  })

  it('invalidates every root for one connection when authority changes', async () => {
    const f = await fixture()
    try {
      const visibleTarget = await prepared(f)
      const visibleRef = await f.catalog.previewResolve(f.principal, visibleTarget)
      if (visibleRef.state !== 'ready') {
        throw new Error('fixture reference unavailable')
      }
      const visibleSession = await f.catalog.previewStart(f.principal, {
        entryRef: visibleRef.entryRef
      })
      if (visibleSession.state !== 'ready') {
        throw new Error('fixture session unavailable')
      }
      const visibleChunk = await f.catalog.previewChunk(f.principal, {
        previewSessionId: visibleSession.previewSessionId,
        offset: 0
      })
      expect(visibleChunk.state).toBe('chunk')
      expect(
        await f.catalog.previewFinish(f.principal, {
          previewSessionId: visibleSession.previewSessionId,
          fileVersion: visibleSession.fileVersion
        })
      ).toMatchObject({ state: 'visible' })

      const secondPath = join(f.base, 'second-vault')
      await mkdir(secondPath)
      const secondRoot = await f.catalog.roots.enrollPickedDirectory(secondPath, 'obsidian-vault')
      const secondPage = await f.catalog.page('desktop', { rootId: secondRoot.rootId }, f.principal)
      expect(secondPage.entries).toHaveLength(1)
      f.catalog.invalidatePreviewAuthority()

      const events = f.invalidations
        .filter((item) => item.connectionId === f.principal.connectionId)
        .map(({ event }) => event as { rootId: string; generation: string; reason: string })
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ rootId: visibleTarget.rootId, reason: 'revoked' }),
          expect.objectContaining({ rootId: secondRoot.rootId, reason: 'revoked' })
        ])
      )
    } finally {
      await f.catalog.close()
    }
  })

  it('requires the separate mobile roster as well as browse and preview grants', async () => {
    const f = await fixture({ pairedMobile: false })
    try {
      const root = await f.catalog.chooseRoot('desktop', 'obsidian-vault')
      if (!root) {
        throw new Error('fixture root was not enrolled')
      }
      expect(() =>
        f.catalog.setPreviewAccess('desktop', {
          rootId: root.rootId,
          desktopPreviewEnabled: false,
          deviceIds: [deviceId]
        })
      ).toThrow('no longer paired for mobile preview')
      expect(f.catalog.roots.previewRegistration(root.rootId)?.allowedPreviewDeviceIds).toEqual([])
    } finally {
      await f.catalog.close()
    }
  })

  it('rejects an out-of-order chunk without reading and scopes a session to its connection', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      const resolved = await f.catalog.previewResolve(f.principal, target)
      if (resolved.state !== 'ready') {
        throw new Error('fixture ref unavailable')
      }
      const started = await f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })
      if (started.state !== 'ready') {
        throw new Error('fixture session unavailable')
      }
      expect(
        await f.catalog.previewChunk(f.principal, {
          previewSessionId: started.previewSessionId,
          offset: 1
        })
      ).toEqual({ state: 'invalid_offset' })
      expect(f.readCalls).toBe(0)
      const other = { ...f.principal, connectionId: 'ipc:other:navigation:1' }
      expect(
        await f.catalog.previewChunk(other, {
          previewSessionId: started.previewSessionId,
          offset: 0
        })
      ).toEqual({ state: 'expired' })
    } finally {
      await f.catalog.close()
    }
  })

  it('clears connection-bound sessions on navigation invalidation', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      const resolved = await f.catalog.previewResolve(f.principal, target)
      if (resolved.state !== 'ready') {
        throw new Error('fixture ref unavailable')
      }
      const started = await f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })
      if (started.state !== 'ready') {
        throw new Error('fixture session unavailable')
      }
      f.catalog.invalidatePreviewConnection(f.principal.connectionId)
      expect(
        await f.catalog.previewChunk(f.principal, {
          previewSessionId: started.previewSessionId,
          offset: 0
        })
      ).toEqual({ state: 'expired' })
      expect(f.readCalls).toBe(0)
    } finally {
      await f.catalog.close()
    }
  })

  it('invalidates active content when the independent browse grant is revoked', async () => {
    const f = await fixture()
    try {
      const target = await prepared(f)
      const resolved = await f.catalog.previewResolve(f.principal, target)
      if (resolved.state !== 'ready') {
        throw new Error('fixture ref unavailable')
      }
      const started = await f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })
      if (started.state !== 'ready') {
        throw new Error('fixture session unavailable')
      }
      f.catalog.setAccess('desktop', target.rootId, [])
      expect(
        await f.catalog.previewChunk(f.principal, {
          previewSessionId: started.previewSessionId,
          offset: 0
        })
      ).toEqual({ state: 'expired' })
    } finally {
      await f.catalog.close()
    }
  })
})
