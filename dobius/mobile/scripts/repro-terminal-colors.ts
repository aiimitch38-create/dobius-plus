/**
 * Minimal mobile terminal color repro.
 *
 * Captures terminal.subscribe snapshots in the same sequence that tab switching
 * uses: terminal A, terminal B, terminal A again. The report tells us whether
 * ANSI SGR color attributes disappeared in the desktop serialized scrollback
 * or are still present and therefore being lost during mobile WebView replay.
 *
 * Usage:
 *   DOBIUS_MOBILE_WS_URL=ws://127.0.0.1:6768 \
 *     pnpm exec tsx scripts/repro-terminal-colors.ts <deviceToken> <serverPublicKeyB64> <worktreeSelector> [handleA] [handleB]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import { createScriptE2EESession } from './e2ee-script-session'

const WS_URL = process.env.DOBIUS_MOBILE_WS_URL ?? 'ws://127.0.0.1:6768'
let token = process.argv[2]
const serverPublicKeyB64 = process.argv[3]
const worktreeSelector = process.argv[4]
const explicitHandleA = process.argv[5]
const explicitHandleB = process.argv[6]
const ESC = String.fromCharCode(27)

type RpcResponse = {
  id: string
  ok: boolean
  streaming?: true
  result?: Record<string, unknown>
  error?: { code: string; message: string }
}

type PendingRequest = {
  method: string
  resolve: (response: RpcResponse) => void
  reject: (error: Error) => void
}

type Snapshot = {
  label: string
  handle: string
  cols: number | null
  rows: number | null
  serialized: string
  lines: string
}

if (!token || !serverPublicKeyB64 || !worktreeSelector) {
  console.error(
    'Usage: pnpm exec tsx scripts/repro-terminal-colors.ts <deviceToken> <serverPublicKeyB64> <worktreeSelector> [handleA] [handleB]'
  )
  process.exit(1)
}

let reqId = 0
const pending = new Map<string, PendingRequest>()
const streamListeners = new Map<string, (result: Record<string, unknown>) => void>()
const e2ee = createScriptE2EESession(serverPublicKeyB64)

function nextId(): string {
  reqId += 1
  return `color-repro-${reqId}`
}

function sendRaw(ws: WebSocket, payload: unknown): void {
  ws.send(e2ee.encrypt(JSON.stringify(payload)))
}

function send(ws: WebSocket, method: string, params?: unknown): Promise<RpcResponse> {
  const id = nextId()
  sendRaw(ws, { id, deviceToken: token, method, params })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      streamListeners.delete(id)
      reject(new Error(`Timed out waiting for ${method}`))
    }, 10_000)
    pending.set(id, {
      method,
      resolve: (response) => {
        clearTimeout(timeout)
        resolve(response)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    })
  })
}

function formatError(response: RpcResponse): string {
  return JSON.stringify(response.error ?? response.result ?? response).slice(0, 1000)
}

async function listHandles(
  ws: WebSocket
): Promise<Array<{ handle: string; title: string | null }>> {
  const response = await send(ws, 'terminal.list', { worktree: worktreeSelector })
  if (!response.ok) {
    throw new Error(`terminal.list failed: ${formatError(response)}`)
  }
  return (
    (response.result?.terminals ?? []) as Array<{ handle: string; title?: string | null }>
  ).map((terminal) => ({
    handle: terminal.handle,
    title: terminal.title ?? null
  }))
}

async function ensureSecondHandle(ws: WebSocket, handleA: string): Promise<string> {
  const terminals = await listHandles(ws)
  const existing = terminals.find((terminal) => terminal.handle !== handleA)
  if (existing) {
    return existing.handle
  }

  const created = await send(ws, 'terminal.create', {
    worktree: worktreeSelector,
    title: 'color-repro-switch-target'
  })
  if (!created.ok) {
    throw new Error(`terminal.create failed: ${formatError(created)}`)
  }
  const handle = (created.result?.terminal as { handle?: string } | undefined)?.handle
  if (!handle) {
    throw new Error(`terminal.create returned no handle: ${formatError(created)}`)
  }
  return handle
}

async function captureSnapshot(ws: WebSocket, label: string, handle: string): Promise<Snapshot> {
  const id = nextId()
  const snapshot = await new Promise<Snapshot>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      streamListeners.delete(id)
      reject(new Error(`Timed out waiting for scrollback snapshot ${label}`))
    }, 10_000)

    pending.set(id, {
      method: 'terminal.subscribe',
      resolve: () => {},
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    })
    streamListeners.set(id, (result) => {
      if (result.type !== 'scrollback') {
        return
      }
      clearTimeout(timeout)
      pending.delete(id)
      streamListeners.delete(id)
      const serialized = typeof result.serialized === 'string' ? result.serialized : ''
      const rawLines = result.lines
      const lines = Array.isArray(rawLines) ? rawLines.join('\n') : String(rawLines ?? '')
      resolve({
        label,
        handle,
        cols: typeof result.cols === 'number' ? result.cols : null,
        rows: typeof result.rows === 'number' ? result.rows : null,
        serialized,
        lines
      })
    })

    sendRaw(ws, {
      id,
      deviceToken: token,
      method: 'terminal.subscribe',
      params: { terminal: handle }
    })
  })

  await send(ws, 'terminal.unsubscribe', { subscriptionId: handle }).catch(() => null)
  return snapshot
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0
}

function summarize(snapshot: Snapshot): Record<string, string | number | null> {
  const data = snapshot.serialized
  return {
    label: snapshot.label,
    handle: snapshot.handle,
    cols: snapshot.cols,
    rows: snapshot.rows,
    serializedBytes: Buffer.byteLength(data),
    sgrTotal: countMatches(data, new RegExp(`${ESC}\\[[0-9;:]*m`, 'g')),
    sgrColor: countMatches(
      data,
      new RegExp(
        `${ESC}\\[(?:[0-9;:]*[;:])?(?:3[0-7]|4[0-7]|9[0-7]|10[0-7]|38[;:]|48[;:])[0-9;:]*m`,
        'g'
      )
    ),
    sgrReset: countMatches(data, new RegExp(`${ESC}\\[(?:0|39|49|0;39;49)m`, 'g')),
    altScreen: data.includes(`${ESC}[?1049h`) ? 'yes' : 'no',
    containsTruecolor: data.includes('38;2') || data.includes('38:2') ? 'yes' : 'no',
    containsPaletteColor: data.includes('38;5') || data.includes('38:5') ? 'yes' : 'no'
  }
}

function saveSnapshots(snapshots: Snapshot[]): string {
  const dir = join(process.cwd(), 'terminal-color-repro')
  mkdirSync(dir, { recursive: true })
  for (const snapshot of snapshots) {
    const base = snapshot.label.replace(/[^a-z0-9_-]/gi, '-')
    writeFileSync(join(dir, `${base}.ansi`), snapshot.serialized || snapshot.lines)
    writeFileSync(
      join(dir, `${base}.escaped.txt`),
      JSON.stringify(snapshot.serialized || snapshot.lines)
    )
  }
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(snapshots.map(summarize), null, 2))
  return dir
}

async function run(ws: WebSocket): Promise<void> {
  // Why: checked at startup; a let loses that narrowing inside this function.
  token = await e2ee.authenticate(ws, token as string)

  const terminals = await listHandles(ws)
  if (terminals.length === 0 && !explicitHandleA) {
    throw new Error('No terminals found. Open a Claude Code terminal first, then rerun.')
  }

  const handleA = explicitHandleA ?? terminals[0]!.handle
  const handleB = explicitHandleB ?? (await ensureSecondHandle(ws, handleA))

  console.log(`A: ${handleA}`)
  console.log(`B: ${handleB}`)

  const firstA = await captureSnapshot(ws, 'a-before-switch', handleA)
  const firstB = await captureSnapshot(ws, 'b-during-switch', handleB)
  const secondA = await captureSnapshot(ws, 'a-after-switch', handleA)
  const snapshots = [firstA, firstB, secondA]
  const dir = saveSnapshots(snapshots)

  console.table(snapshots.map(summarize))
  console.log(`saved: ${dir}`)
  if (summarize(firstA).sgrColor !== summarize(secondA).sgrColor) {
    console.log(
      'color SGR count changed between A snapshots: serialization/state changed on desktop'
    )
  } else {
    console.log('A snapshots have the same color SGR count: likely mobile replay/render path')
  }
}

const ws = new WebSocket(WS_URL)

ws.on('open', () => {
  run(ws)
    .then(() => {
      ws.close()
      process.exit(0)
    })
    .catch((error) => {
      console.error(error.message)
      ws.close()
      process.exit(1)
    })
})

ws.on('message', (data) => {
  const raw = data.toString()
  if (raw.startsWith('{')) {
    return
  }
  const plaintext = e2ee.decrypt(raw)
  if (!plaintext) {
    return
  }

  const response = JSON.parse(plaintext) as RpcResponse
  const result = response.result
  const streamListener = streamListeners.get(response.id)
  if (streamListener && response.ok && (response.streaming || result?.type === 'scrollback')) {
    streamListener(result ?? {})
    return
  }

  const request = pending.get(response.id)
  if (!request || request.method === 'terminal.subscribe') {
    return
  }
  pending.delete(response.id)
  request.resolve(response)
})

ws.on('close', () => {
  for (const request of pending.values()) {
    request.reject(new Error('WebSocket closed'))
  }
  pending.clear()
})

ws.on('error', (error) => {
  console.error(`WebSocket error: ${error.message}`)
  process.exit(1)
})
