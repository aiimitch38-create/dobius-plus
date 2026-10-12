import { execFileSync } from 'node:child_process'
import { readFile, lstat, open, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'

export function assertDobiusClosed() {
  const processes = execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' })
  if (processes.split('\n').some((line) => line.endsWith('/Contents/MacOS/Dobius+'))) {
    throw new Error(
      'Close Dobius+ yourself before reading or changing phone permissions. This script never quits or reopens it.'
    )
  }
}

export async function grantMobilePermission({
  registryPath,
  deviceId,
  grant,
  dryRun = false,
  checkClosed = assertDobiusClosed,
  confirm,
  print = console.log
}) {
  if (grant !== 'screen.view') {
    throw new Error('Only screen.view is supported by this Phase 1 helper.')
  }
  if (!isAbsolute(registryPath) || !deviceId) {
    throw new Error('Provide an absolute registry path and an explicit deviceId.')
  }
  checkClosed()
  const info = await lstat(registryPath)
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid()) {
    throw new Error('Registry must be a regular file owned by your user.')
  }
  const original = await readFile(registryPath)
  let devices
  try {
    devices = JSON.parse(original.toString('utf8'))
  } catch {
    throw new Error('Device registry is invalid; no changes made.')
  }
  if (
    !Array.isArray(devices) ||
    devices.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        typeof item.deviceId !== 'string' ||
        typeof item.token !== 'string' ||
        typeof item.name !== 'string' ||
        (item.grants !== undefined &&
          (!Array.isArray(item.grants) || item.grants.some((value) => typeof value !== 'string')))
    ) ||
    new Set(devices.map((item) => item.deviceId)).size !== devices.length
  ) {
    throw new Error('Device registry schema is invalid; no changes made.')
  }
  const device = devices.find((item) => item.deviceId === deviceId)
  if (!device || (device.scope !== undefined && device.scope !== 'mobile')) {
    throw new Error('That exact deviceId is not a paired mobile device.')
  }
  const name = device.name.replace(/\p{Cc}/gu, ' ').slice(0, 100)
  print(
    `Phone: ${name}\nDevice ID: ${deviceId}\nPermission: ${grant}\nYour phone will be able to view everything visible on your main display, including private messages and passwords.`
  )
  if (dryRun) {
    print('Dry run: no files changed.')
    return { changed: false }
  }
  if (device.grants?.includes(grant)) {
    print('This phone already has screen.view; no files changed.')
    return { changed: false }
  }
  if (!confirm || !(await confirm(name, deviceId))) {
    print('Cancelled; no files changed.')
    return { changed: false }
  }
  checkClosed()
  const lockPath = `${registryPath}.screen-grant.lock`
  const lock = await open(lockPath, 'wx', 0o600)
  const temp = join(dirname(registryPath), `.screen-grant-${randomUUID()}.tmp`)
  try {
    // No registry credentials are printed; backups and replacement stay private.
    const backup = await open(`${registryPath}.screen-view-backup-${randomUUID()}`, 'wx', 0o600)
    try {
      await backup.writeFile(original)
      await backup.sync()
    } finally {
      await backup.close()
    }
    device.grants = [...(device.grants ?? []), grant]
    const replacement = await open(temp, 'wx', 0o600)
    try {
      await replacement.writeFile(`${JSON.stringify(devices, null, 2)}\n`)
      await replacement.sync()
    } finally {
      await replacement.close()
    }
    checkClosed()
    const latestInfo = await lstat(registryPath)
    if (
      !latestInfo.isFile() ||
      latestInfo.isSymbolicLink() ||
      latestInfo.ino !== info.ino ||
      !original.equals(await readFile(registryPath))
    ) {
      throw new Error('Registry changed during confirmation; no grant written.')
    }
    checkClosed()
    await rename(temp, registryPath)
    print(
      `Added only screen.view to ${name}. Reopen Dobius+ yourself, open Desktop on your phone, and approve the named phone on your Mac.`
    )
    return { changed: true }
  } finally {
    await unlink(temp).catch(() => {})
    await lock.close()
    await unlink(lockPath)
  }
}

async function main() {
  const [deviceId, grant, ...flags] = process.argv.slice(2)
  let dryRun = false
  let registryPath = join(
    homedir(),
    'Library',
    'Application Support',
    'dobius-plus',
    'dobius-devices.json'
  )
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--dry-run') {
      dryRun = true
    } else if (flags[i] === '--registry' && flags[i + 1]) {
      registryPath = flags[++i]
    } else {
      throw new Error(
        'Usage: scripts/grant-mobile-permission.sh <deviceId> screen.view [--dry-run] [--registry <absolute path>]'
      )
    }
  }
  await grantMobilePermission({
    registryPath,
    deviceId,
    grant,
    dryRun,
    confirm: async (name, id) => {
      if (!process.stdin.isTTY) {
        throw new Error('Run interactively to confirm the named phone. No grant written.')
      }
      const prompt = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return (
          (
            await prompt.question(`To confirm “${name}”, type its exact device ID (${id}): `)
          ).trim() === id
        )
      } finally {
        prompt.close()
      }
    }
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
