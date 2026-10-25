/* Image attachments on Kanban cards.
 *
 * The renderer only ever sends bytes (base64) plus a name and a mime type.
 * Main chooses the id, the extension (from the mime, never the name) and the
 * path, writes the file 0600 inside the card's own directory, and records it on
 * the task. Reads resolve the path from the stored record and refuse anything
 * that does not stay under the attachments root. */

import { randomBytes } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import {
  isVertexTaskAttachmentMime,
  sniffVertexTaskAttachmentMime,
  VERTEX_TASK_ATTACHMENT_EXT,
  VERTEX_TASK_ATTACHMENT_MAX_BYTES,
  VERTEX_TASK_ATTACHMENTS_MAX,
  type VertexTaskAttachment,
  type VertexTaskAttachmentInput,
  type VertexTaskAttachmentKind,
} from '../../shared/vertex-task-types'
import {
  isInsideAttachmentsRoot,
  isSafeAttachmentId,
  vertexTaskAttachmentDir,
} from './vertex-attachment-paths'
import { vertexTaskStore } from './vertex-task-store'

const NAME_MAX = 120
const ADDED_BY_MAX = 80

// Why: base64 inflates by 4/3; refusing on string length avoids decoding a
// payload that is going to be rejected anyway.
const MAX_BASE64_LENGTH = Math.ceil(VERTEX_TASK_ATTACHMENT_MAX_BYTES / 3) * 4 + 4

export function addVertexTaskAttachment(
  taskId: string,
  input: VertexTaskAttachmentInput,
): VertexTaskAttachment {
  if (!isSafeAttachmentId(taskId)) {
    throw new Error('Invalid task id')
  }
  if (!isVertexTaskAttachmentMime(input.mime)) {
    throw new Error(`Unsupported image type: ${String(input.mime)}`)
  }
  if (typeof input.dataBase64 !== 'string' || input.dataBase64.length > MAX_BASE64_LENGTH) {
    throw new Error(`Image is larger than ${VERTEX_TASK_ATTACHMENT_MAX_BYTES} bytes`)
  }
  const data = Buffer.from(input.dataBase64, 'base64')
  if (data.byteLength === 0) {
    throw new Error('Image is empty')
  }
  if (data.byteLength > VERTEX_TASK_ATTACHMENT_MAX_BYTES) {
    throw new Error(`Image is larger than ${VERTEX_TASK_ATTACHMENT_MAX_BYTES} bytes`)
  }
  const task = vertexTaskStore.list().find((candidate) => candidate.id === taskId)
  if (!task) {
    throw new Error('Task not found')
  }
  const existing = task.attachments ?? []
  if (existing.length >= VERTEX_TASK_ATTACHMENTS_MAX) {
    throw new Error(`A card holds at most ${VERTEX_TASK_ATTACHMENTS_MAX} images`)
  }

  const id = randomBytes(12).toString('hex')
  const dir = vertexTaskAttachmentDir(taskId)
  const filePath = path.join(dir, `${id}.${VERTEX_TASK_ATTACHMENT_EXT[input.mime]}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(filePath, data, { mode: 0o600, flag: 'wx' })

  const attachment: VertexTaskAttachment = {
    id,
    name: cleanName(input.name, id),
    path: filePath,
    mime: input.mime,
    bytes: data.byteLength,
    createdAt: Date.now(),
    kind: input.kind === 'proof' ? 'proof' : 'screenshot',
  }
  const addedBy = cleanName(input.addedBy, '').slice(0, ADDED_BY_MAX)
  if (addedBy) {
    attachment.addedBy = addedBy
  }
  const updated = vertexTaskStore.update(taskId, { attachments: [...existing, attachment] })
  if (!updated) {
    rmSync(filePath, { force: true })
    throw new Error('Could not record the image on the card')
  }
  return attachment
}

export type VertexTaskProofInput = {
  name?: string
  kind?: VertexTaskAttachmentKind
  addedBy?: string
}

/** Attach raw image bytes an agent sent. The format comes from the magic
 * bytes, never from a name or a declared mime. */
export function addVertexTaskAttachmentFromBytes(
  taskId: string,
  data: Buffer,
  input: VertexTaskProofInput,
): VertexTaskAttachment {
  if (data.byteLength > VERTEX_TASK_ATTACHMENT_MAX_BYTES) {
    throw new Error(`Image is larger than ${VERTEX_TASK_ATTACHMENT_MAX_BYTES} bytes`)
  }
  const mime = sniffVertexTaskAttachmentMime(data)
  if (!mime) {
    throw new Error('Not a PNG, JPEG, WebP or GIF image (checked the file bytes, not the name)')
  }
  return addVertexTaskAttachment(taskId, {
    name: input.name ?? `${input.kind ?? 'screenshot'}.${VERTEX_TASK_ATTACHMENT_EXT[mime]}`,
    mime,
    dataBase64: data.toString('base64'),
    kind: input.kind,
    addedBy: input.addedBy,
  })
}

/** Attach an image file on this machine (the local `dobius tasks attach`).
 * The path must be absolute. The file is opened with O_NOFOLLOW and checked
 * through its descriptor, so a symlink or a swap between check and read cannot
 * point main at a file the caller could not read itself. */
export function addVertexTaskAttachmentFromFile(
  taskId: string,
  file: string,
  input: VertexTaskProofInput,
): VertexTaskAttachment {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    throw new Error('Image path must be absolute')
  }
  let fd: number
  try {
    // Why O_NONBLOCK: opening a FIFO read-only would otherwise hang main.
    fd = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ELOOP') {
      throw new Error(`Image path is a symlink, refused: ${file}`)
    }
    if (code === 'ENOENT') {
      throw new Error(`Image not found: ${file}`)
    }
    throw new Error(`Could not open image ${file}: ${code ?? String(err)}`)
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) {
      throw new Error(`Not a regular file: ${file}`)
    }
    if (stat.size > VERTEX_TASK_ATTACHMENT_MAX_BYTES) {
      throw new Error(`Image is larger than ${VERTEX_TASK_ATTACHMENT_MAX_BYTES} bytes`)
    }
    return addVertexTaskAttachmentFromBytes(taskId, readFileSync(fd), {
      ...input,
      name: input.name ?? path.basename(file),
    })
  } finally {
    closeSync(fd)
  }
}

/** The stored image as a data URL for thumbnails, or null when it is gone. */
export function readVertexTaskAttachment(taskId: string, attachmentId: string): string | null {
  if (!isSafeAttachmentId(taskId) || !isSafeAttachmentId(attachmentId)) {
    return null
  }
  const task = vertexTaskStore.list().find((candidate) => candidate.id === taskId)
  const record = task?.attachments?.find((candidate) => candidate.id === attachmentId)
  if (!record || !isInsideAttachmentsRoot(record.path)) {
    return null
  }
  try {
    if (statSync(record.path).size > VERTEX_TASK_ATTACHMENT_MAX_BYTES) {
      return null
    }
    return `data:${record.mime};base64,${readFileSync(record.path).toString('base64')}`
  } catch (err) {
    console.warn('[vertex] attachment unreadable:', record.path, err)
    return null
  }
}

function cleanName(name: unknown, fallback: string): string {
  const trimmed = typeof name === 'string' ? name.replace(/[\r\n\t]/g, ' ').trim() : ''
  return (trimmed || fallback).slice(0, NAME_MAX)
}
