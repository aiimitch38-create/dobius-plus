import { schnorr } from '@noble/curves/secp256k1'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { computeRelayEventId } from './relay-event'
import { RelayStore } from './relay-store'
import { startRelayServer, type RelayServerHandle } from './relay-server'
import type { RelayEvent } from './relay-types'

/**
 * Every server here binds port 0 (ephemeral) — never RELAY_PORT, which the
 * developer's own running Dobius+ may hold.
 */
const openServers: RelayServerHandle[] = []
const openStores: RelayStore[] = []
const openSockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    socket.close()
  }
  for (const handle of openServers.splice(0)) {
    await handle.close()
  }
  for (const store of openStores.splice(0)) {
    store.close()
  }
})

async function startTestRelay(): Promise<{ store: RelayStore; base: string; port: number }> {
  const store = new RelayStore(':memory:')
  openStores.push(store)
  const handle = await startRelayServer({ store, port: 0, host: '127.0.0.1' })
  openServers.push(handle)
  return { store, base: `http://127.0.0.1:${handle.port}`, port: handle.port }
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

type Keypair = { secretKey: Uint8Array; pubkey: string }

function makeKeypair(): Keypair {
  const secretKey = schnorr.utils.randomSecretKey()
  return { secretKey, pubkey: toHex(schnorr.getPublicKey(secretKey)) }
}

type EventDraft = { created_at?: number; kind?: number; tags?: string[][]; content?: string }

/** Mirrors relay-event.test.ts: a genuinely signed event, the baseline tests mutate. */
function signEvent(keys: Keypair, draft: EventDraft = {}): RelayEvent {
  const unsigned = {
    id: '',
    pubkey: keys.pubkey,
    created_at: draft.created_at ?? Math.floor(Date.now() / 1000) - 60,
    kind: draft.kind ?? 1,
    tags: draft.tags ?? [['h', 'room-1']],
    content: draft.content ?? 'hello relay',
    sig: ''
  }
  const id = computeRelayEventId(unsigned)
  return { ...unsigned, id, sig: toHex(schnorr.sign(id, keys.secretKey)) }
}

function post(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pubkey': 'a'.repeat(64) },
    body: JSON.stringify(body)
  })
}

/**
 * Queue-backed frame reader so tests can await frames in order without sleeps.
 *
 * The relay now challenges every connection with an unsolicited `["AUTH",
 * challenge]` frame as soon as it opens (NIP-42). That frame is captured into
 * `authChallenge` instead of the `next()` queue, so every pre-existing test
 * here — none of which cares about auth — keeps seeing exactly the frame
 * sequence it always did.
 */
function openSocketReader(
  port: number
): Promise<{ socket: WebSocket; next: () => Promise<unknown[]>; authChallenge: Promise<string> }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`)
    openSockets.push(socket)
    const queue: unknown[][] = []
    const waiters: ((frame: unknown[]) => void)[] = []
    let resolveAuthChallenge: (challenge: string) => void
    const authChallenge = new Promise<string>((res) => {
      resolveAuthChallenge = res
    })

    socket.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString()) as unknown[]
      if (frame[0] === 'AUTH' && typeof frame[1] === 'string') {
        resolveAuthChallenge(frame[1])
        return
      }
      const waiter = waiters.shift()
      if (waiter) {
        waiter(frame)
        return
      }
      queue.push(frame)
    })
    socket.on('error', reject)
    socket.on('open', () => {
      resolve({
        socket,
        authChallenge,
        next: () => {
          const queued = queue.shift()
          return queued
            ? Promise.resolve(queued)
            : new Promise<unknown[]>((resolveFrame) => waiters.push(resolveFrame))
        }
      })
    })
  })
}

describe('relay HTTP routes', () => {
  it('round-trips an event from POST /events to POST /query', async () => {
    const { base } = await startTestRelay()
    const event = signEvent(makeKeypair(), { content: 'round trip' })

    const submission = await post(base, '/events', event)
    expect(submission.status).toBe(200)
    expect(await submission.json()).toEqual({ accepted: true, event_id: event.id })

    const query = await post(base, '/query', [{ kinds: [1], '#h': ['room-1'] }])
    expect(query.status).toBe(200)
    expect(await query.json()).toEqual([event])
  })

  it('returns an empty array when nothing matches', async () => {
    const { base } = await startTestRelay()

    const query = await post(base, '/query', [{ kinds: [0] }])
    expect(query.status).toBe(200)
    expect(await query.json()).toEqual([])
  })

  it('rejects a bad-signature event with 400 and a readable body', async () => {
    const { base } = await startTestRelay()
    const forged = { ...signEvent(makeKeypair()), sig: 'a'.repeat(128) }

    const response = await post(base, '/events', forged)
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('invalid: event signature verification failed')
  })

  it('rejects a structurally invalid event and unparseable JSON with 400', async () => {
    const { base } = await startTestRelay()

    const malformed = await post(base, '/events', { id: 'nope' })
    expect(malformed.status).toBe(400)
    expect(await malformed.text()).toBe('invalid: not a well-formed Nostr event')

    const broken = await fetch(`${base}/events`, { method: 'POST', body: '{not json' })
    expect(broken.status).toBe(400)
    expect(await broken.text()).toBe('invalid request: body must be JSON')
  })

  it('rejects a query body that is not an array of filters', async () => {
    const { base } = await startTestRelay()

    const response = await post(base, '/query', { kinds: [1] })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe(
      'invalid request: body must be a JSON array of NIP-01 filters'
    )
  })

  it('reports a duplicate submission as accepted with a message', async () => {
    const { base } = await startTestRelay()
    const event = signEvent(makeKeypair())

    await post(base, '/events', event)
    const repeat = await post(base, '/events', event)

    expect(repeat.status).toBe(200)
    expect(await repeat.json()).toEqual({
      accepted: true,
      event_id: event.id,
      message: 'duplicate: event already stored'
    })
  })

  it('404s an unknown path and 405s a non-POST on a known one', async () => {
    const { base } = await startTestRelay()

    const unknown = await fetch(`${base}/nope`, { method: 'POST' })
    expect(unknown.status).toBe(404)
    expect(await unknown.text()).toBe('not found: /nope')

    const wrongMethod = await fetch(`${base}/query`)
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('POST, OPTIONS')
  })
})

describe('relay CORS', () => {
  it('answers the preflight with 204 and the headers the file: origin needs', async () => {
    const { base } = await startTestRelay()

    const response = await fetch(`${base}/events`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'null',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, x-pubkey'
      }
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type, X-Pubkey')
    expect(response.headers.get('access-control-max-age')).toBe('86400')
  })

  it('preflights an unknown path too, so the browser never masks the real status', async () => {
    const { base } = await startTestRelay()

    const response = await fetch(`${base}/whatever`, { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('sets Access-Control-Allow-Origin on success AND on error responses', async () => {
    const { base } = await startTestRelay()

    const ok = await post(base, '/query', [])
    const badRequest = await post(base, '/events', { id: 'nope' })
    const notFound = await fetch(`${base}/nope`, { method: 'POST' })
    const notAllowed = await fetch(`${base}/query`)

    for (const response of [ok, badRequest, notFound, notAllowed]) {
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      await response.text()
    }
  })
})

describe('relay WebSocket', () => {
  it('answers REQ with stored EVENTs then EOSE', async () => {
    const { base, port } = await startTestRelay()
    const keys = makeKeypair()
    const older = signEvent(keys, { created_at: 1_700_000_000, content: 'older' })
    const newer = signEvent(keys, { created_at: 1_700_000_100, content: 'newer' })
    await post(base, '/events', older)
    await post(base, '/events', newer)

    const { socket, next } = await openSocketReader(port)
    socket.send(JSON.stringify(['REQ', 'sub-1', { kinds: [1] }]))

    expect(await next()).toEqual(['EVENT', 'sub-1', newer])
    expect(await next()).toEqual(['EVENT', 'sub-1', older])
    expect(await next()).toEqual(['EOSE', 'sub-1'])
  })

  it('sends EOSE with no events when the store is empty', async () => {
    const { port } = await startTestRelay()

    const { socket, next } = await openSocketReader(port)
    socket.send(JSON.stringify(['REQ', 'empty', { kinds: [9] }]))

    expect(await next()).toEqual(['EOSE', 'empty'])
  })

  it('accepts an EVENT frame with OK and stores it', async () => {
    const { base, port } = await startTestRelay()
    const event = signEvent(makeKeypair(), { content: 'over the socket' })

    const { socket, next } = await openSocketReader(port)
    socket.send(JSON.stringify(['EVENT', event]))

    expect(await next()).toEqual(['OK', event.id, true, ''])
    const query = await post(base, '/query', [{ ids: [event.id] }])
    expect(await query.json()).toEqual([event])
  })

  it('answers a bad-signature EVENT frame with OK false and the reason', async () => {
    const { port } = await startTestRelay()
    const forged = { ...signEvent(makeKeypair()), sig: 'a'.repeat(128) }

    const { socket, next } = await openSocketReader(port)
    socket.send(JSON.stringify(['EVENT', forged]))

    expect(await next()).toEqual([
      'OK',
      forged.id,
      false,
      'invalid: event signature verification failed'
    ])
  })

  it('fans a live event out to a matching subscriber', async () => {
    const { base, port } = await startTestRelay()

    const { socket, next } = await openSocketReader(port)
    socket.send(JSON.stringify(['REQ', 'live', { kinds: [1], '#h': ['room-1'] }]))
    expect(await next()).toEqual(['EOSE', 'live'])

    const event = signEvent(makeKeypair(), { content: 'live push' })
    await post(base, '/events', event)

    expect(await next()).toEqual(['EVENT', 'live', event])
  })

  it('does not push events that no live filter matches', async () => {
    const { base, port } = await startTestRelay()

    const { socket, next } = await openSocketReader(port)
    socket.send(JSON.stringify(['REQ', 'live', { kinds: [9] }]))
    expect(await next()).toEqual(['EOSE', 'live'])

    await post(base, '/events', signEvent(makeKeypair(), { kind: 1 }))
    const matching = signEvent(makeKeypair(), { kind: 9, content: 'chat' })
    await post(base, '/events', matching)

    // The kind-1 event must not appear ahead of it in the stream.
    expect(await next()).toEqual(['EVENT', 'live', matching])
  })

  it('fans a socket-published event out to another socket but not back to the publisher', async () => {
    const { port } = await startTestRelay()

    const listener = await openSocketReader(port)
    listener.socket.send(JSON.stringify(['REQ', 'listen', { kinds: [1] }]))
    expect(await listener.next()).toEqual(['EOSE', 'listen'])

    const publisher = await openSocketReader(port)
    publisher.socket.send(JSON.stringify(['REQ', 'self', { kinds: [1] }]))
    expect(await publisher.next()).toEqual(['EOSE', 'self'])

    const event = signEvent(makeKeypair(), { content: 'from a socket' })
    publisher.socket.send(JSON.stringify(['EVENT', event]))

    expect(await listener.next()).toEqual(['EVENT', 'listen', event])
    expect(await publisher.next()).toEqual(['OK', event.id, true, ''])
  })

  it('stops pushing after CLOSE', async () => {
    const { base, port } = await startTestRelay()

    const { socket, next } = await openSocketReader(port)
    socket.send(JSON.stringify(['REQ', 'temp', { kinds: [1] }]))
    expect(await next()).toEqual(['EOSE', 'temp'])
    socket.send(JSON.stringify(['CLOSE', 'temp']))
    // A second REQ round trip proves the CLOSE was processed before the publish.
    socket.send(JSON.stringify(['REQ', 'probe', { kinds: [7] }]))
    expect(await next()).toEqual(['EOSE', 'probe'])

    await post(base, '/events', signEvent(makeKeypair(), { content: 'after close' }))

    socket.send(JSON.stringify(['REQ', 'drain', { kinds: [7] }]))
    expect(await next()).toEqual(['EOSE', 'drain'])
  })

  it('answers malformed frames with NOTICE and keeps the connection usable', async () => {
    const { port } = await startTestRelay()
    const { socket, next } = await openSocketReader(port)

    socket.send('not json at all')
    expect(await next()).toEqual([
      'NOTICE',
      'invalid: frame must be a JSON array starting with a verb'
    ])

    socket.send(JSON.stringify({ verb: 'REQ' }))
    expect(await next()).toEqual([
      'NOTICE',
      'invalid: frame must be a JSON array starting with a verb'
    ])

    socket.send(JSON.stringify(['REQ', 42]))
    expect(await next()).toEqual(['NOTICE', 'invalid: REQ needs a string subscription id'])

    socket.send(JSON.stringify(['REQ', 'sub', 'not-a-filter']))
    expect(await next()).toEqual(['NOTICE', 'invalid: REQ sub carries a malformed filter'])

    socket.send(JSON.stringify(['COUNT', 'sub']))
    expect(await next()).toEqual(['NOTICE', 'invalid: unsupported verb COUNT'])

    socket.send(JSON.stringify(['EVENT', { id: 'nope' }]))
    expect(await next()).toEqual(['NOTICE', 'invalid: not a well-formed Nostr event'])

    // Still alive after all of that.
    socket.send(JSON.stringify(['REQ', 'alive', { kinds: [1] }]))
    expect(await next()).toEqual(['EOSE', 'alive'])
  })

  it('drops a disconnected socket subscription instead of leaking it', async () => {
    const { base, port } = await startTestRelay()

    const { socket, next } = await openSocketReader(port)
    socket.send(JSON.stringify(['REQ', 'gone', { kinds: [1] }]))
    expect(await next()).toEqual(['EOSE', 'gone'])

    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve())
      socket.close()
    })

    // Publishing to a store whose only subscriber has left must not throw.
    const response = await post(base, '/events', signEvent(makeKeypair()))
    expect(response.status).toBe(200)
  })
})

describe('relay lifecycle', () => {
  it('resolves with an inert handle when the port is already in use', async () => {
    const { port } = await startTestRelay()
    const store = new RelayStore(':memory:')
    openStores.push(store)

    const second = await startRelayServer({ store, port, host: '127.0.0.1' })

    expect(second.port).toBe(port)
    await expect(second.close()).resolves.toBeUndefined()
  })

  it('stops answering after close', async () => {
    const store = new RelayStore(':memory:')
    openStores.push(store)
    const handle = await startRelayServer({ store, port: 0, host: '127.0.0.1' })
    const base = `http://127.0.0.1:${handle.port}`

    expect((await post(base, '/query', [])).status).toBe(200)
    await handle.close()

    await expect(post(base, '/query', [])).rejects.toThrow()
  })

  it('rejects a body over 1 MB with 413', async () => {
    const { base } = await startTestRelay()
    const oversized = signEvent(makeKeypair(), { content: 'x'.repeat(1024 * 1024 + 64) })

    const response = await post(base, '/events', oversized)

    expect(response.status).toBe(413)
    expect(await response.text()).toBe('request body too large')
  })
})

describe('relay NIP-42 AUTH', () => {
  /** A kind-22242 event carrying the two tags NIP-42 requires. */
  function signAuthEvent(
    keys: Keypair,
    challenge: string,
    overrides: { kind?: number; created_at?: number } = {}
  ): RelayEvent {
    return signEvent(keys, {
      kind: overrides.kind ?? 22242,
      tags: [
        ['relay', 'ws://127.0.0.1:0/'],
        ['challenge', challenge]
      ],
      created_at: overrides.created_at ?? Math.floor(Date.now() / 1000),
      content: ''
    })
  }

  it('sends an AUTH challenge on connect and accepts a correctly signed response', async () => {
    const { port } = await startTestRelay()
    const { socket, next, authChallenge } = await openSocketReader(port)

    const challenge = await authChallenge
    expect(typeof challenge).toBe('string')
    expect(challenge.length).toBeGreaterThan(0)

    const authEvent = signAuthEvent(makeKeypair(), challenge)
    socket.send(JSON.stringify(['AUTH', authEvent]))

    expect(await next()).toEqual(['OK', authEvent.id, true, ''])
  })

  it('rejects an AUTH event carrying the wrong challenge', async () => {
    const { port } = await startTestRelay()
    const { socket, next, authChallenge } = await openSocketReader(port)
    await authChallenge

    const authEvent = signAuthEvent(makeKeypair(), 'not-the-issued-challenge')
    socket.send(JSON.stringify(['AUTH', authEvent]))

    expect(await next()).toEqual([
      'OK',
      authEvent.id,
      false,
      'invalid: AUTH event challenge does not match'
    ])
  })

  it('rejects an AUTH event of the wrong kind', async () => {
    const { port } = await startTestRelay()
    const { socket, next, authChallenge } = await openSocketReader(port)
    const challenge = await authChallenge

    const authEvent = signAuthEvent(makeKeypair(), challenge, { kind: 1 })
    socket.send(JSON.stringify(['AUTH', authEvent]))

    expect(await next()).toEqual([
      'OK',
      authEvent.id,
      false,
      'invalid: AUTH event must be kind 22242'
    ])
  })

  it('rejects an AUTH event with a bad signature', async () => {
    const { port } = await startTestRelay()
    const { socket, next, authChallenge } = await openSocketReader(port)
    const challenge = await authChallenge

    const forged = { ...signAuthEvent(makeKeypair(), challenge), sig: 'a'.repeat(128) }
    socket.send(JSON.stringify(['AUTH', forged]))

    expect(await next()).toEqual([
      'OK',
      forged.id,
      false,
      'invalid: event signature verification failed'
    ])
  })

  it('rejects a stale AUTH event', async () => {
    const { port } = await startTestRelay()
    const { socket, next, authChallenge } = await openSocketReader(port)
    const challenge = await authChallenge

    const authEvent = signAuthEvent(makeKeypair(), challenge, {
      created_at: Math.floor(Date.now() / 1000) - 3600
    })
    socket.send(JSON.stringify(['AUTH', authEvent]))

    expect(await next()).toEqual(['OK', authEvent.id, false, 'invalid: AUTH event is too old'])
  })

  it('keeps serving REQ and EVENT on a socket that never authenticates', async () => {
    const { base, port } = await startTestRelay()
    const { socket, next, authChallenge } = await openSocketReader(port)
    // Challenge arrives but is deliberately ignored, like relay-client.ts does today.
    await authChallenge

    socket.send(JSON.stringify(['REQ', 'no-auth', { kinds: [1] }]))
    expect(await next()).toEqual(['EOSE', 'no-auth'])

    const event = signEvent(makeKeypair(), { content: 'unauthenticated still works' })
    socket.send(JSON.stringify(['EVENT', event]))
    expect(await next()).toEqual(['OK', event.id, true, ''])

    const query = await post(base, '/query', [{ ids: [event.id] }])
    expect(await query.json()).toEqual([event])
  })
})

describe('relay DM channel provisioning', () => {
  /** A kind-41010 "open a DM" request naming `others` as the other participants. */
  function signDmOpenEvent(author: Keypair, others: Keypair[]): RelayEvent {
    return signEvent(author, { kind: 41010, tags: others.map((keys) => ['p', keys.pubkey]) })
  }

  function channelIdFrom(message: string | undefined): string {
    expect(message?.startsWith('response:')).toBe(true)
    const payload = JSON.parse((message as string).slice('response:'.length)) as {
      channel_id: string
    }
    expect(typeof payload.channel_id).toBe('string')
    expect(payload.channel_id.length).toBeGreaterThan(0)
    return payload.channel_id
  }

  it('provisions a kind-39000 channel naming every participant and returns its id', async () => {
    const { base } = await startTestRelay()
    const author = makeKeypair()
    const other = makeKeypair()

    const submission = await post(base, '/events', signDmOpenEvent(author, [other]))
    expect(submission.status).toBe(200)
    const body = (await submission.json()) as { message?: string }
    const channelId = channelIdFrom(body.message)

    const metadata = await post(base, '/query', [{ kinds: [39000], '#d': [channelId] }])
    const channels = (await metadata.json()) as RelayEvent[]
    expect(channels).toHaveLength(1)
    const participantTags = channels[0].tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1])
    expect(new Set(participantTags)).toEqual(new Set([author.pubkey, other.pubkey]))
  })

  it('resolves the same participant set to the same channel, whoever opens it and in whatever tag order', async () => {
    const { base } = await startTestRelay()
    const a = makeKeypair()
    const b = makeKeypair()
    const c = makeKeypair()

    const first = await post(base, '/events', signDmOpenEvent(a, [b, c]))
    const firstId = channelIdFrom(((await first.json()) as { message?: string }).message)

    // Re-opened by a DIFFERENT participant, with the other two pubkeys in the opposite order.
    const second = await post(base, '/events', signDmOpenEvent(b, [c, a]))
    const secondId = channelIdFrom(((await second.json()) as { message?: string }).message)

    // Re-opened again by the original participant — must still resolve, not duplicate.
    const third = await post(base, '/events', signDmOpenEvent(a, [b, c]))
    const thirdId = channelIdFrom(((await third.json()) as { message?: string }).message)

    expect(secondId).toBe(firstId)
    expect(thirdId).toBe(firstId)

    const metadata = await post(base, '/query', [{ kinds: [39000], '#d': [firstId], limit: 10 }])
    expect(await metadata.json()).toHaveLength(1)
  })

  it('rejects a DM open event with no other participants instead of creating a degenerate channel', async () => {
    const { base } = await startTestRelay()

    const before = await post(base, '/query', [{ kinds: [39000], limit: 1000 }])
    const beforeCount = ((await before.json()) as RelayEvent[]).length

    const response = await post(base, '/events', signDmOpenEvent(makeKeypair(), []))
    expect(response.status).toBe(400)
    expect(await response.text()).toBe(
      'invalid: DM open event needs at least one other participant'
    )

    const after = await post(base, '/query', [{ kinds: [39000], limit: 1000 }])
    expect(((await after.json()) as RelayEvent[]).length).toBe(beforeCount)
  })
})
