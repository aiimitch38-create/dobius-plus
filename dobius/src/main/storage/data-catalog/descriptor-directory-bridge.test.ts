import { execFileSync } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDescriptorDirectoryBridge,
  DescriptorDirectoryBridgeError
} from './descriptor-directory-bridge'
import type { RegisteredCatalogRoot } from './types'
import type { MetadataDirectoryHandle } from './metadata-scanner'
import { DescriptorDirectoryTransport } from './descriptor-directory-transport'

const bridgeScript = resolve(
  process.cwd(),
  'config/scripts/data-catalog/descriptor-directory-bridge.py'
)
const cleanupPaths: string[] = []
const bridges: ReturnType<typeof createDescriptorDirectoryBridge>[] = []

async function tempDirectory(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'dobius-descriptor-bridge-')))
  cleanupPaths.push(path)
  return path
}

async function registeredRoot(path: string): Promise<RegisteredCatalogRoot> {
  const bridge = createBridge()
  const identity = await bridge.captureRootIdentity(path)
  await bridge.dispose()
  return {
    id: 'bridge-test-root',
    kind: 'folder-workspace',
    label: 'Temporary bridge test root',
    canonicalPath: path,
    identity,
    generation: 'bridge-test-generation',
    browseGranted: true
  }
}

function createBridge(
  scriptPath = bridgeScript,
  operationTimeoutMs = 1000
): ReturnType<typeof createDescriptorDirectoryBridge> {
  const bridge = createDescriptorDirectoryBridge({
    pythonExecutable:
      process.platform === 'win32'
        ? 'python.exe'
        : execFileSync('which', ['python3'], { encoding: 'utf8' }).trim(),
    scriptPath,
    operationTimeoutMs
  })
  bridges.push(bridge)
  return bridge
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    try {
      await stat(path)
      return
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        return
      }
      throw error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(`Owned bridge child ${pid} did not exit`)
}

async function waitForCleanup(
  bridge: ReturnType<typeof createDescriptorDirectoryBridge>
): Promise<void> {
  const deadline = Date.now() + 2000
  while (!bridge.cleanupConfirmed && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  expect(bridge.cleanupConfirmed).toBe(true)
}

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.dispose()))
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe.skipIf(process.platform === 'win32')('descriptor directory bridge', () => {
  it('walks real temporary roots while preserving backslashes and Unicode names', async () => {
    const rootPath = await tempDirectory()
    const literalBackslash = 'literal\\name'
    const unicode = 'café-雪'
    await writeFile(join(rootPath, literalBackslash), 'content is never requested')
    await mkdir(join(rootPath, unicode))
    const root = await registeredRoot(rootPath)
    const bridge = createBridge()
    expect(bridge.supportsRaceSafeDirectoryHandles).toBe(true)

    const handle = await bridge.openRoot(root)
    const names: string[] = []
    while (true) {
      const entry = await handle.read()
      if (entry === null) {
        break
      }
      names.push(entry.name)
    }
    expect(names.sort()).toEqual([literalBackslash, unicode].sort())
    const listedStat = await bridge.lstatChild(handle, literalBackslash)
    expect(listedStat).toMatchObject({ kind: 'file' })
    expect(listedStat.previewIdentity).toMatchObject({ fileType: 'regular' })
    expect(listedStat.previewIdentity?.sizeBytes).toBe(
      String(Buffer.byteLength('content is never requested'))
    )
    const child = await bridge.openChildDirectory(handle, unicode)
    expect(await bridge.verifyChild(handle, unicode, child.identity)).toBe(true)
    await child.close()
    await handle.close()
    await bridge.dispose()
  })

  it('projects extended native root identity to the strict descriptor protocol', async () => {
    const rootPath = await tempDirectory()
    const root = await registeredRoot(rootPath)
    const extendedRoot = {
      ...root,
      identity: { ...root.identity, birthtimeNs: '90071992547409931234' }
    } as RegisteredCatalogRoot
    const bridge = createBridge()

    const handle = await bridge.openRoot(extendedRoot)
    await expect(bridge.verifyRoot(extendedRoot, handle)).resolves.toBe(true)
    await handle.close()
  })

  it('captures native identity on the opened descriptor and detects replacement', async () => {
    const rootPath = await tempDirectory()
    const bridge = createBridge()
    const identity = await bridge.captureRootIdentity(rootPath)
    expect(identity.dev).toMatch(/^(0|[1-9][0-9]*)$/)
    expect(identity.ino).toMatch(/^[1-9][0-9]*$/)
    expect(identity.incarnation.token).toMatch(/^[1-9][0-9]*$/)
    expect(identity.incarnation.provider).toBe(
      process.platform === 'darwin' ? 'darwin-apfs-file-id-v1' : 'linux-inode-generation-v1'
    )
    const root: RegisteredCatalogRoot = {
      id: 'catalog:bridge-test-root',
      kind: 'folder-workspace',
      label: 'Temporary bridge test root',
      canonicalPath: rootPath,
      identity,
      generation: 'bridge-test-generation',
      browseGranted: true
    }
    const handle = await bridge.openRoot(root)
    const firstToken = identity.incarnation.token
    await mkdir(join(rootPath, 'ordinary-child'))
    await expect(bridge.captureRootIdentity(rootPath)).resolves.toEqual(identity)

    const replacementPath = `${rootPath}-replacement`
    await rename(rootPath, replacementPath)
    await mkdir(rootPath)
    const replacementIdentity = await bridge.captureRootIdentity(rootPath)
    expect(replacementIdentity.incarnation.scope).toBe(identity.incarnation.scope)
    expect(replacementIdentity.incarnation.token).not.toBe(firstToken)
    await expect(bridge.verifyRoot(root, handle)).resolves.toBe(false)
    await expect(handle.read()).rejects.toMatchObject({ code: 'identity_changed' })
    await handle.close()
  })

  it('publishes a stable helper epoch and binds handles and tickets to recovered epochs', async () => {
    const rootPath = await tempDirectory()
    const root = await registeredRoot(rootPath)
    const bridge = createBridge()
    expect(bridge.previewHelperEpoch()).toBeNull()

    const oldHandle = await bridge.openRoot(root)
    const ticketEpoch = bridge.previewHelperEpoch()
    expect(ticketEpoch).toEqual(expect.any(String))
    expect(ticketEpoch).not.toBe('')
    expect(bridge.previewHelperEpoch()).toBe(ticketEpoch)

    const inFlightPreview = bridge.statPreview(root, oldHandle, ['pending.md'])
    const cancellation = bridge.cancel()
    expect(bridge.previewHelperEpoch()).toBeNull()
    await expect(inFlightPreview).rejects.toMatchObject({ code: 'cancelled' })
    await cancellation
    await waitForCleanup(bridge)
    await expect(oldHandle.read()).rejects.toMatchObject({ code: 'unavailable' })

    const newHandle = await bridge.openRoot(root)
    const replacementEpoch = bridge.previewHelperEpoch()
    expect(replacementEpoch).toEqual(expect.any(String))
    expect(replacementEpoch).not.toBe(ticketEpoch)
    expect(bridge.previewHelperEpoch()).toBe(replacementEpoch)
    expect(replacementEpoch).not.toBe(ticketEpoch) // An old ticket cannot cross helper replacement.
    await expect(bridge.verifyRoot(root, oldHandle)).rejects.toMatchObject({
      code: 'unsupported'
    })
    await newHandle.close()
  })

  it('invalidates the synchronous helper epoch immediately when disposed', async () => {
    const rootPath = await tempDirectory()
    const root = await registeredRoot(rootPath)
    const bridge = createBridge()
    await bridge.openRoot(root)
    expect(bridge.previewHelperEpoch()).toEqual(expect.any(String))

    const disposal = bridge.dispose()
    expect(bridge.previewHelperEpoch()).toBeNull()
    await disposal
    expect(bridge.previewHelperEpoch()).toBeNull()
  })

  it('reads ordered bounded chunks only through an opened root and exact stat version', async () => {
    const rootPath = await tempDirectory()
    const contents = Buffer.from('preview fixture: café 雪\n'.repeat(900), 'utf8')
    await writeFile(join(rootPath, 'sample.txt'), contents)
    const root = await registeredRoot(rootPath)
    const bridge = createBridge()
    const openedRoot = await bridge.openRoot(root)
    const stat = await bridge.statPreview(root, openedRoot, ['sample.txt'])

    expect(stat.sizeBytes).toBe(String(contents.byteLength))
    expect(stat.dev).toMatch(/^(0|[1-9][0-9]*)$/)
    expect(stat.mtimeNs).toMatch(/^(0|[1-9][0-9]*)$/)
    expect(stat.fileVersion).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(stat)).not.toContain(rootPath)

    const chunks: Buffer[] = []
    let offset = 0
    while (offset < contents.byteLength) {
      const length = Math.min(16 * 1024, contents.byteLength - offset)
      const chunk = await bridge.readPreviewChunk(
        root,
        openedRoot,
        ['sample.txt'],
        stat,
        offset,
        length
      )
      expect(chunk.offset).toBe(offset)
      expect(chunk.nextOffset - chunk.offset).toBe(length)
      chunks.push(Buffer.from(chunk.dataBase64, 'base64'))
      offset = chunk.nextOffset
      expect(chunk.final).toBe(offset === contents.byteLength)
    }
    expect(Buffer.concat(chunks)).toEqual(contents)

    await writeFile(join(rootPath, 'sample.txt'), 'replacement')
    await expect(
      bridge.readPreviewChunk(root, openedRoot, ['sample.txt'], stat, 0, 16 * 1024)
    ).rejects.toMatchObject({ code: 'identity_changed' })
    await openedRoot.close()
  })

  it('rejects forged components and non-root directory handles for preview', async () => {
    const rootPath = await tempDirectory()
    await mkdir(join(rootPath, 'nested'))
    const root = await registeredRoot(rootPath)
    const bridge = createBridge()
    const openedRoot = await bridge.openRoot(root)
    const child = await bridge.openChildDirectory(openedRoot, 'nested')
    await expect(bridge.statPreview(root, child, ['sample.txt'])).rejects.toMatchObject({
      code: 'protocol'
    })
    await expect(bridge.statPreview(root, openedRoot, ['..', 'outside'])).rejects.toMatchObject({
      code: 'protocol'
    })
    await child.close()
    await openedRoot.close()
  })

  it('loads the packaged native provider beside the bridge, not from caller cwd', async () => {
    const callerDirectory = await tempDirectory()
    const rootPath = await tempDirectory()
    await writeFile(
      join(callerDirectory, 'native-root-identity.py'),
      `raise RuntimeError('caller cwd provider must not load')\n`
    )
    const previousCwd = process.cwd()
    const bridge = createBridge()
    try {
      process.chdir(callerDirectory)
      const identity = await bridge.captureRootIdentity(rootPath)
      expect(identity.incarnation.provider).toBe(
        process.platform === 'darwin' ? 'darwin-apfs-file-id-v1' : 'linux-inode-generation-v1'
      )
    } finally {
      process.chdir(previousCwd)
    }
  })

  it('rejects a registered root with a mismatched native incarnation token', async () => {
    const rootPath = await tempDirectory()
    const root = await registeredRoot(rootPath)
    const bridge = createBridge()
    const wrongToken = root.identity.incarnation.token === '1' ? '2' : '1'
    const mismatchedRoot: RegisteredCatalogRoot = {
      ...root,
      identity: {
        ...root.identity,
        incarnation: { ...root.identity.incarnation, token: wrongToken }
      }
    }

    await expect(bridge.openRoot(mismatchedRoot)).rejects.toMatchObject({
      code: 'identity_changed'
    })
  })

  it('fails closed and disposes the helper on malformed native identity output', async () => {
    const rootPath = await tempDirectory()
    const malformed = join(rootPath, 'malformed-identity.py')
    await writeFile(
      malformed,
      `import json, sys\n` +
        `for line in sys.stdin:\n` +
        ` request = json.loads(line)\n` +
        ` print(json.dumps({'id':request['id'],'ok':True,'result':{'dev':'1','ino':'2','incarnation':{'provider':'unknown','scope':'0','token':'0'}}}), flush=True)\n`
    )
    const bridge = createBridge(malformed)

    await expect(bridge.captureRootIdentity(rootPath)).rejects.toMatchObject({ code: 'protocol' })
    await waitForCleanup(bridge)
    await expect(bridge.captureRootIdentity(rootPath)).rejects.toMatchObject({ code: 'protocol' })
  })

  it('bounds repeated recovery epochs and never remaps stale handles', async () => {
    const parent = await tempDirectory()
    const rootPaths = Array.from({ length: 4 }, (_, index) => join(parent, `root-${index + 1}`))
    await Promise.all(rootPaths.map((path) => mkdir(path)))
    const roots = await Promise.all(rootPaths.map((path) => registeredRoot(path)))
    const countPath = join(parent, 'count')
    const logPath = join(parent, 'ops')
    const script = join(parent, 'recover-once.py')
    await writeFile(
      script,
      `import json, os, pathlib, sys\n` +
        `count_path = pathlib.Path(${JSON.stringify(countPath)})\n` +
        `count = int(count_path.read_text()) + 1 if count_path.exists() else 1\n` +
        `count_path.write_text(str(count))\n` +
        `log_path = pathlib.Path(${JSON.stringify(logPath)})\n` +
        `for line in sys.stdin:\n` +
        ` request = json.loads(line)\n` +
        ` with log_path.open('a') as output: output.write(str(count) + ':' + request['op'] + '\\n')\n` +
        ` if request['op'] == 'open_root':\n` +
        `  result = {'handleId': str(count), 'identity': {'dev': request['identity']['dev'], 'ino': request['identity']['ino']}}\n` +
        `  print(json.dumps({'id': request['id'], 'ok': True, 'result': result}), flush=True)\n` +
        ` elif request['op'] == 'read' and count < 4:\n` +
        `  os._exit(17)\n` +
        ` elif request['op'] == 'read':\n` +
        `  print(json.dumps({'id': request['id'], 'ok': True, 'result': None}), flush=True)\n` +
        ` else:\n` +
        `  print(json.dumps({'id': request['id'], 'ok': True, 'result': True}), flush=True)\n`
    )
    const disposeSpy = vi.spyOn(DescriptorDirectoryTransport.prototype, 'dispose')
    const bridge = createBridge(script)
    const staleHandles: { read(): Promise<{ name: string } | null> }[] = []
    for (const root of roots.slice(0, -1)) {
      const handle = await bridge.openRoot(root)
      staleHandles.push(handle)
      await expect(handle.read()).rejects.toMatchObject({ code: 'exit' })
      await waitForCleanup(bridge)
    }
    const freshHandle = await bridge.openRoot(roots[3])
    await expect(freshHandle.read()).resolves.toBeNull()
    for (const staleHandle of staleHandles) {
      await expect(staleHandle.read()).rejects.toMatchObject({ code: 'unavailable' })
      await expect(
        bridge.verifyRoot(roots[0], staleHandle as MetadataDirectoryHandle)
      ).rejects.toMatchObject({ code: 'unsupported' })
    }
    expect(await readFile(countPath, 'utf8')).toBe('4')
    expect(await readFile(logPath, 'utf8')).toBe(
      '1:open_root\n1:read\n2:open_root\n2:read\n3:open_root\n3:read\n4:open_root\n4:read\n'
    )
    await bridge.dispose()
    expect(disposeSpy).toHaveBeenCalledTimes(1)
    disposeSpy.mockRestore()
    await expect(bridge.openRoot(roots[3])).rejects.toMatchObject({ code: 'unavailable' })
    expect(await readFile(countPath, 'utf8')).toBe('4')
  })

  it('refuses a replacement epoch while the previous child exit is unconfirmed', async () => {
    const parent = await tempDirectory()
    const rootPath = join(parent, 'root')
    await mkdir(rootPath)
    const root = await registeredRoot(rootPath)
    const pidPath = join(parent, 'pid')
    const launchPath = join(parent, 'launches')
    const script = join(parent, 'hang.py')
    await writeFile(
      script,
      `import os, pathlib, sys, time\n` +
        `launch = pathlib.Path(${JSON.stringify(launchPath)})\n` +
        `with launch.open('a') as output: output.write('start\\n')\n` +
        `pathlib.Path(${JSON.stringify(pidPath)}).write_text(str(os.getpid()))\n` +
        `for line in sys.stdin: time.sleep(30)\n`
    )
    const originalRequest = DescriptorDirectoryTransport.prototype.request
    const requestSpy = vi
      .spyOn(DescriptorDirectoryTransport.prototype, 'request')
      .mockImplementation(function (
        this: DescriptorDirectoryTransport,
        op: string,
        args?: Record<string, unknown>
      ) {
        const pending = originalRequest.call(this, op, args)
        if (op === 'open_root') {
          const child = (
            this as unknown as {
              child: { kill(signal: string): boolean } | null
            }
          ).child
          if (child) {
            child.kill = () => true
          }
        }
        return pending
      })
    const bridge = createBridge(script, 250)
    const pending = bridge.openRoot(root)
    await waitForFile(pidPath)
    const pid = Number(await readFile(pidPath, 'utf8'))
    expect(bridge.cleanupConfirmed).toBe(false)
    await expect(pending).rejects.toMatchObject({ code: 'timeout' })
    expect(bridge.previewHelperEpoch()).toBeNull()
    expect(bridge.cleanupConfirmed).toBe(false)
    await expect(bridge.openRoot(root)).rejects.toMatchObject({ code: 'unavailable' })
    expect(await readFile(launchPath, 'utf8')).toBe('start\n')

    process.kill(pid, 'SIGKILL')
    await waitForProcessExit(pid)
    requestSpy.mockRestore()
  })

  it('rejects symlink roots and refuses symlink/FIFO children without opening content', async () => {
    const parent = await tempDirectory()
    const rootPath = join(parent, 'root')
    const outside = join(parent, 'outside')
    await mkdir(rootPath)
    await writeFile(outside, 'do not read')
    await symlink(outside, join(rootPath, 'file-link'))
    const fifoPath = join(rootPath, 'fifo')
    execFileSync('mkfifo', [fifoPath])
    const bridge = createBridge()
    const root = await registeredRoot(rootPath)
    const handle = await bridge.openRoot(root)
    await expect(bridge.lstatChild(handle, 'file-link')).resolves.toMatchObject({ kind: 'symlink' })
    await expect(bridge.lstatChild(handle, 'fifo')).resolves.toMatchObject({ kind: 'fifo' })
    await expect(bridge.openChildDirectory(handle, 'file-link')).rejects.toBeInstanceOf(
      DescriptorDirectoryBridgeError
    )
    await expect(bridge.openChildDirectory(handle, 'fifo')).rejects.toBeInstanceOf(
      DescriptorDirectoryBridgeError
    )
    await handle.close()

    const linkedRoot = join(parent, 'linked-root')
    await symlink(rootPath, linkedRoot)
    await expect(
      bridge.openRoot(
        await registeredRoot(rootPath).then((value) => ({
          ...value,
          canonicalPath: linkedRoot
        }))
      )
    ).rejects.toBeInstanceOf(DescriptorDirectoryBridgeError)
  })

  it('detects a child rename after its descriptor is opened', async () => {
    const rootPath = await tempDirectory()
    const childPath = join(rootPath, 'child')
    await mkdir(childPath)
    const root = await registeredRoot(rootPath)
    const bridge = createBridge()
    const parent = await bridge.openRoot(root)
    const before = await bridge.lstatChild(parent, 'child')
    const child = await bridge.openChildDirectory(parent, 'child')
    await rename(childPath, join(rootPath, 'moved'))
    await mkdir(childPath)
    expect(child.identity).toEqual(before.identity)
    await expect(bridge.verifyChild(parent, 'child', child.identity)).resolves.toBe(false)
    await child.close()
    await parent.close()
  })

  it('rejects a directory handle created by a different bridge over another real root', async () => {
    const firstPath = await tempDirectory()
    const secondPath = await tempDirectory()
    await writeFile(join(firstPath, 'first-only'), 'one')
    await writeFile(join(secondPath, 'second-only'), 'two')
    const firstBridge = createBridge()
    const secondBridge = createBridge()
    const firstHandle = await firstBridge.openRoot(await registeredRoot(firstPath))
    const secondHandle = await secondBridge.openRoot(await registeredRoot(secondPath))

    await expect(firstBridge.lstatChild(secondHandle, 'first-only')).rejects.toMatchObject({
      code: 'unsupported'
    })
    await expect(secondBridge.lstatChild(firstHandle, 'second-only')).rejects.toMatchObject({
      code: 'unsupported'
    })
    await expect(firstBridge.lstatChild(firstHandle, 'first-only')).resolves.toMatchObject({
      kind: 'file'
    })
    await expect(secondBridge.lstatChild(secondHandle, 'second-only')).resolves.toMatchObject({
      kind: 'file'
    })
  })

  it('fails closed when read and verification results have invalid DTO shapes', async () => {
    const rootPath = await tempDirectory()
    const root = await registeredRoot(rootPath)
    const malformed = join(rootPath, 'malformed.py')
    const script =
      `import json, sys\n` +
      `for line in sys.stdin:\n` +
      ` request = json.loads(line)\n` +
      ` op = request['op']\n` +
      ` result = {'handleId':'1','identity':${JSON.stringify({ dev: root.identity.dev, ino: root.identity.ino })}} if op == 'open_root' else ({'dev':'1','ino':'2','incarnation':{'provider':'bad','scope':'0','token':'0'}} if op == 'capture_root_identity' else ({'name': 7} if op == 'read' else 'yes'))\n` +
      ` print(json.dumps({'id':request['id'],'ok':True,'result':result}), flush=True)\n` +
      ` if op == 'read' or op == 'verify_root': break\n`
    await writeFile(malformed, script)

    const readBridge = createBridge(malformed)
    const readHandle = await readBridge.openRoot(root)
    await expect(readHandle.read()).rejects.toMatchObject({ code: 'protocol' })
    await waitForCleanup(readBridge)
    const recoveredReadHandle = await readBridge.openRoot(root)
    await expect(readHandle.read()).rejects.toMatchObject({ code: 'unavailable' })
    await recoveredReadHandle.close().catch(() => undefined)

    const verifyBridge = createBridge(malformed)
    const verifyHandle = await verifyBridge.openRoot(root)
    await expect(verifyBridge.verifyRoot(root, verifyHandle)).rejects.toMatchObject({
      code: 'protocol'
    })
    await waitForCleanup(verifyBridge)
    await expect(verifyBridge.verifyRoot(root, verifyHandle)).rejects.toMatchObject({
      code: 'unavailable'
    })

    const identityBridge = createBridge(malformed)
    await expect(identityBridge.captureRootIdentity(root.canonicalPath)).rejects.toMatchObject({
      code: 'protocol'
    })
    await waitForCleanup(identityBridge)
    await expect(identityBridge.captureRootIdentity(root.canonicalPath)).rejects.toMatchObject({
      code: 'protocol'
    })
  })

  it('refuses requests after disposal before the helper has started', async () => {
    const rootPath = await tempDirectory()
    const pidPath = join(rootPath, 'started')
    const script = join(rootPath, 'must-not-start.py')
    await writeFile(script, `import pathlib\npathlib.Path(${JSON.stringify(pidPath)}).touch()\n`)
    const bridge = createBridge(script)
    await bridge.dispose()
    expect(bridge.cleanupConfirmed).toBe(true)
    await expect(bridge.openRoot(await registeredRoot(rootPath))).rejects.toMatchObject({
      code: 'unavailable'
    })
    await expect(stat(pidPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('bounds stuck transport, rejects all pending requests, and kills only its child', async () => {
    const rootPath = await tempDirectory()
    const pidFile = join(rootPath, 'bridge.pid')
    const hangingScript = join(rootPath, 'hang.py')
    await writeFile(
      hangingScript,
      `import os, pathlib, sys, time\n` +
        `sys.stdin.readline()\nsys.stdin.readline()\n` +
        `pathlib.Path(${JSON.stringify(pidFile)}).write_text(str(os.getpid()))\n` +
        `time.sleep(30)\n`
    )
    const bridge = createBridge(hangingScript, 1200)
    const root = await registeredRoot(rootPath)
    const pending = [bridge.openRoot(root), bridge.openRoot(root)]
    const resultsPromise = Promise.allSettled(pending)
    await waitForFile(pidFile)
    const bridgePid = Number(await readFile(pidFile, 'utf8'))
    const results = await resultsPromise
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'timeout' })
      }
    }
    await waitForProcessExit(bridgePid)
  })

  it('cancels outstanding transport and disposes the owned child', async () => {
    const rootPath = await tempDirectory()
    const pidFile = join(rootPath, 'cancel.pid')
    const hangingScript = join(rootPath, 'cancel.py')
    await writeFile(
      hangingScript,
      `import os, pathlib, sys, time\n` +
        `sys.stdin.readline()\n` +
        `pathlib.Path(${JSON.stringify(pidFile)}).write_text(str(os.getpid()))\n` +
        `time.sleep(30)\n`
    )
    const bridge = createBridge(hangingScript, 2000)
    const request = bridge.openRoot(await registeredRoot(rootPath))
    await waitForFile(pidFile)
    const bridgePid = Number(await readFile(pidFile, 'utf8'))
    expect(bridge.previewHelperEpoch()).toEqual(expect.any(String))
    const cancellation = bridge.cancel()
    expect(bridge.previewHelperEpoch()).toBeNull()
    await expect(request).rejects.toMatchObject({ code: 'cancelled' })
    await cancellation
    await waitForProcessExit(bridgePid)
  })

  it('fails closed when the configured interpreter cannot start', async () => {
    const rootPath = await tempDirectory()
    const bridge = createBridge(join(rootPath, 'missing-python'))
    const result = await bridge.openRoot(await registeredRoot(rootPath)).then(
      () => null,
      (error: unknown) => error
    )
    expect(result).toBeInstanceOf(DescriptorDirectoryBridgeError)
    expect(['spawn', 'exit']).toContain((result as DescriptorDirectoryBridgeError).code)
    expect(bridge.cleanupConfirmed).toBe(true)
  })
})
