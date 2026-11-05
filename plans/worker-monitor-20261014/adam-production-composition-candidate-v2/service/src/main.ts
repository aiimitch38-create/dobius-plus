import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AdamService } from './runtime/service.js'

const stamp = (): string => new Date().toISOString()

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '../..')
const dataDir = process.env.ADAM_DATA_DIR || join(projectRoot, 'service', 'data')
const port = Number(process.env.ADAM_PORT || 8791)
const service = new AdamService({
  dataDir,
  port,
  commitmentsPath: join(projectRoot, 'COMMITMENTS.md'),
  promptProfilesPath: join(projectRoot, 'config', 'prompt-profiles.yaml'),
  modelRoutingPath: join(projectRoot, 'config', 'model-routing.yaml')
})

async function main(): Promise<void> {
  // The --once / --prepare-tomorrow branches emit machine-read JSON on stdout;
  // never prefix those with stamp() — only lifecycle log lines get a timestamp.
  if (process.argv.includes('--once')) {
    const result = await service.reconcile()
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`)
    await service.stop()
    return
  }
  if (process.argv.includes('--prepare-tomorrow')) {
    const result = await service.supervisor.prepareTomorrow({
      channel: 'cli',
      senderId: 'carson',
      dedupeKey: `cli:${new Date().toISOString().slice(0, 10)}`
    })
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`)
    await service.stop()
    return
  }
  await service.start()
  process.stdout.write(`${stamp()} ADAM service listening on 127.0.0.1:${port}\n`)
  const shutdown = async (): Promise<void> => {
    process.stdout.write(`${stamp()} ADAM service stopping\n`)
    await service.stop()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch(async (error) => {
  process.stderr.write(`${stamp()} ${error instanceof Error ? error.stack : String(error)}\n`)
  await service.stop().catch(() => undefined)
  process.exit(1)
})
