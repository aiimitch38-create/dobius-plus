import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DescriptorDirectoryTransport } from './descriptor-directory-transport'

const temporaryPaths: string[] = []
const transports: DescriptorDirectoryTransport[] = []

async function fixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dobius-directory-transport-'))
  temporaryPaths.push(path)
  return path
}

function transport(scriptPath: string, operationTimeoutMs = 1000): DescriptorDirectoryTransport {
  const instance = new DescriptorDirectoryTransport({
    pythonExecutable: execFileSync('which', ['python3'], { encoding: 'utf8' }).trim(),
    scriptPath,
    operationTimeoutMs
  })
  transports.push(instance)
  return instance
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    try {
      const content = await readFile(path, 'utf8')
      if (content.length > 0) {
        return
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

async function waitForExit(pid: number): Promise<void> {
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
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Owned child ${pid} did not exit`)
}

afterEach(async () => {
  await Promise.all(transports.splice(0).map((item) => item.dispose()))
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('descriptor directory transport', () => {
  it('keeps caller data from overriding the generated request identity and operation', async () => {
    const directory = await fixture()
    const script = join(directory, 'echo.py')
    await writeFile(
      script,
      `import json, sys\n` +
        `request = json.loads(sys.stdin.readline())\n` +
        `print(json.dumps({'id': request['id'], 'ok': True, 'result': request['op']}), flush=True)\n`
    )
    const child = transport(script)
    await expect(child.request('caps', { id: 'forged', op: 'shutdown' })).resolves.toBe('caps')
  })

  it('rejects malformed wire replies and terminates its owned child', async () => {
    const directory = await fixture()
    const pidPath = join(directory, 'pid')
    const script = join(directory, 'malformed.py')
    await writeFile(
      script,
      `import os, pathlib, sys, time\n` +
        `sys.stdin.readline()\n` +
        `pathlib.Path(${JSON.stringify(pidPath)}).write_text(str(os.getpid()))\n` +
        `print('{"id":3,"ok":"yes"}', flush=True)\n` +
        `time.sleep(30)\n`
    )
    const child = transport(script)
    const request = child.request('caps')
    await expect(request).rejects.toMatchObject({ code: 'protocol' })
    await waitForFile(pidPath)
    await waitForExit(Number(await readFile(pidPath, 'utf8')))
  })

  it('settles all pending requests at the deadline and kills only its owned child', async () => {
    const directory = await fixture()
    const pidPath = join(directory, 'pid')
    const script = join(directory, 'hang.py')
    await writeFile(
      script,
      `import os, pathlib, sys, time\n` +
        `sys.stdin.readline()\n` +
        `pathlib.Path(${JSON.stringify(pidPath)}).write_text(str(os.getpid()))\n` +
        `time.sleep(30)\n`
    )
    const child = transport(script, 1200)
    const pending = [child.request('caps'), child.request('caps')]
    const settledPromise = Promise.allSettled(pending)
    await waitForFile(pidPath)
    const pid = Number(await readFile(pidPath, 'utf8'))
    expect(Number.isInteger(pid)).toBe(true)
    expect(pid).toBeGreaterThan(1)
    const settled = await settledPromise
    expect(settled.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(settled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'rejected',
          reason: expect.objectContaining({ code: 'timeout' })
        })
      ])
    )
    await waitForExit(pid)
  })

  it('bounds cancellation and reports an unconfirmed exit until the owned child exits', async () => {
    const directory = await fixture()
    const pidPath = join(directory, 'pid')
    const script = join(directory, 'hang-unconfirmed.py')
    await writeFile(
      script,
      `import os, pathlib, sys, time\n` +
        `sys.stdin.readline()\n` +
        `pathlib.Path(${JSON.stringify(pidPath)}).write_text(str(os.getpid()))\n` +
        `time.sleep(30)\n`
    )
    const child = transport(script, 5000)
    const request = child.request('caps')
    const observedRequest = request.catch((error: unknown) => error)
    await waitForFile(pidPath)
    const pid = Number(await readFile(pidPath, 'utf8'))
    const spawnedChild = (
      child as unknown as {
        child: { kill(signal: string): boolean } | null
      }
    ).child
    expect(spawnedChild).not.toBeNull()
    expect(child.cleanupConfirmed).toBe(false)
    spawnedChild!.kill = () => true

    const started = Date.now()
    await child.cancel()
    expect(Date.now() - started).toBeLessThan(600)
    expect(child.cleanupConfirmed).toBe(false)
    await expect(observedRequest).resolves.toMatchObject({ code: 'cancelled' })

    process.kill(pid, 'SIGKILL')
    await waitForExit(pid)
    expect(child.cleanupConfirmed).toBe(true)
  })
})
