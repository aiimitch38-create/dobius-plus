import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function readAdamVoiceSession(
  file: string,
  profileHome: string
): Promise<string | null> {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'))
    return data.profileHome === profileHome &&
      typeof data.sessionId === 'string' &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(data.sessionId)
      ? data.sessionId
      : null
  } catch {
    return null
  }
}

export async function saveAdamVoiceSession(
  file: string,
  profileHome: string,
  sessionId: string
): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify({ profileHome, sessionId }), { mode: 0o600, flag: 'wx' })
    await rename(temp, file)
  } finally {
    await rm(temp, { force: true })
  }
}
