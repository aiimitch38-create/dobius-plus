import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudBackupController, validateCloudConnection } from './controller'

const input = {
  bucket: 'dobius-test-backups',
  region: 'us-east-1',
  accessKeyId: 'example-key',
  secretAccessKey: 'example-secret'
}
let base: string
let controller: CloudBackupController
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'dobius-aws-settings-'))
  mkdirSync(join(base, 'state'))
  controller = new CloudBackupController({
    base,
    scripts: base,
    python: '/usr/bin/python3',
    supported: true,
    sourcePaths: () => ['/projects'],
    applicationDataPath: '/appdata'
  })
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})
function state(config: object, status: object): void {
  writeFileSync(join(base, 'config.json'), JSON.stringify(config))
  writeFileSync(join(base, 'state/status.json'), JSON.stringify(status))
}

describe('AWS desktop backup control', () => {
  it('does not claim protection for an unconfigured or failed backup', () => {
    expect(controller.getStatus()).toMatchObject({ health: 'not_configured', configured: false })
    state(
      { repository: 's3:https://s3.us-east-1.amazonaws.com/my-bucket/laptop' },
      { health: 'failed', detail: 'Restore failed' }
    )
    expect(controller.getStatus()).toMatchObject({ health: 'failed', detail: 'Restore failed' })
  })
  it('never returns credential fields or raw private config to the renderer', () => {
    state(
      {
        repository: 's3:https://s3.us-east-1.amazonaws.com/my-bucket/laptop',
        secretAccessKey: 'secret-marker',
        password_file: '/private/key',
        sources: [{ path: '/projects', required: true }]
      },
      { health: 'healthy', access_key_id: 'private-marker', last_backup_at: 'date' }
    )
    const status = controller.getStatus()
    expect(status).toMatchObject({
      bucket: 'my-bucket',
      sources: ['/projects'],
      lastBackupAt: 'date'
    })
    expect(JSON.stringify(status)).not.toMatch(/secret-marker|private-marker|password_file/)
  })
  it('shows interrupted workers as failures and respects paused schedules', () => {
    state(
      { repository: 's3:https://s3.us-east-1.amazonaws.com/my-bucket/laptop' },
      { health: 'running', pid: 2147483647 }
    )
    expect(controller.getStatus().health).toBe('failed')
    state(
      { repository: 's3:https://s3.us-east-1.amazonaws.com/my-bucket/laptop', enabled: false },
      { health: 'healthy' }
    )
    expect(controller.getStatus()).toMatchObject({ health: 'paused', enabled: false })
  })
  it('validates in main without echoing invalid secret input', () => {
    for (const change of [
      { bucket: 'https://bucket' },
      { bucket: '127.0.0.1' },
      { bucket: 'bad..bucket' },
      { secretAccessKey: '' },
      { region: 'unknown' },
      { accessKeyId: 'secret\nmarker' }
    ]) {
      expect(() => validateCloudConnection({ ...input, ...change })).toThrow()
    }
    expect(() => validateCloudConnection({ ...input, accessKeyId: 'secret\nmarker' })).toThrow(
      'invalid field'
    )
  })
  it('starts the worker with credentials on stdin and reports its persisted outcome', async () => {
    writeFileSync(
      join(base, 'settings_bridge.py'),
      `import json,sys,os,time\nfrom pathlib import Path\np=Path(sys.argv[2]);data=json.load(sys.stdin)\n(p/'received.json').write_text(json.dumps({'args':sys.argv,'key_received':data['secretAccessKey']=='example-secret'}))\n(p/'state/status.json').write_text(json.dumps({'health':'healthy','detail':'Restore verified'}))\n`
    )
    const initial = await controller.connect(input)
    expect(initial.health).toBe('connecting')
    await vi.waitFor(() => expect(controller.getStatus().health).toBe('healthy'))
    const received = JSON.parse(readFileSync(join(base, 'received.json'), 'utf8'))
    expect(received.key_received).toBe(true)
    expect(JSON.stringify(received.args)).not.toContain('example-secret')
  })
  it('blocks unsupported platforms instead of collecting unusable credentials', async () => {
    const unsupported = new CloudBackupController({
      base,
      scripts: base,
      python: '',
      supported: false,
      sourcePaths: () => [],
      applicationDataPath: base
    })
    expect(unsupported.getStatus().health).toBe('unsupported')
    await expect(unsupported.connect(input)).rejects.toThrow('available on macOS')
  })
})
