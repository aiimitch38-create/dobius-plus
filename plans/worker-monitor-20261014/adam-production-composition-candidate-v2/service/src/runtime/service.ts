import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { DobiusClient } from '../adapters/dobius.js'
import { CapabilityRegistry, type CapabilityCheck, type ReadinessLevel } from '../capabilities/registry.js'
import { databaseIntegrity, openDatabase, type AdamDatabase } from '../db/database.js'
import { SessionAwareness } from '../sessions/awareness.js'
import { SessionMonitor } from '../sessions/monitor.js'
import { AdamSupervisor } from '../supervisor/supervisor.js'
import { TerminalDispatcher } from '../terminals/dispatch.js'
import { renderPrompt, TerminalDispatchRequestSchema } from '../terminals/prompt.js'
import { loadPromptProfiles, type PromptProfile } from '../prompts/compiler.js'
import { AmbiguousTerminalError, ProjectTerminalResolver } from '../projects/resolver.js'
import { loadProjectRegistry, type ProjectRegistry } from '../projects/registry.js'
import { checkContextHandshake, ContextHandshakeRequestSchema, renderContextPack, type ContextPack } from '../projects/handshake.js'
import { WorkerPreflightPlanner } from '../workers/preflight.js'
import { WorkerLauncher } from '../workers/launcher.js'
import { WorkerLaunchRequestSchema, WorkerPreflightRequestSchema } from '../workers/request.js'
import { loadModelRoutingConfig } from '../models/config.js'
import { ModelRouteRequestSchema } from '../models/request.js'
import { OmniRouteModelRouter } from '../models/router.js'
import { CloudReceiptError, DobiusCloudReceiptStore } from '../dobius-cloud/receipt-store.js'
import { IMessageCommandGateway } from '../imessage/gateway.js'
import { AuthoritativeOrchestrationSupervisor, loadOrchestrationAlertsConfig, type OrchestrationAlertsConfig } from '../orchestration/supervisor.js'
import { handleUtterance } from '../converse/converse.js'
import { ChannelHeartbeat } from '../health/channel-heartbeat.js'
import { OrchestrationJobRequestSchema } from '../orchestration/contract.js'
import { JobStore } from '../jobs/store.js'
import { IMessageModelClassifier } from '../models/imessage-classifier.js'
import { IMessageConversationFrameManager } from '../imessage/frame.js'
import { DobiusEventSchema, ingestDobiusEvent } from '../events/ingest.js'
import {
  APPROVED_DECISION_RECOVERY_INTERVAL_MS, createApprovedDecisionPublisher,
  type ApprovedDecisionPublisher
} from '../dobius-cloud/approved-decision-publisher.js'
import type { ApprovedCloudDecisionAuthority } from '../dobius-cloud/approved-decision-contract.js'
import type { IntentBridgeCredentialAuthority, IntentBridgeCall } from '../dobius-cloud/intent-bridge-cli.js'

const MAX_BODY_BYTES = 64 * 1024

export type ServiceOptions = {
  dataDir: string
  port: number
  awarenessIntervalMs?: number
  commitmentsPath?: string
  promptProfilesPath?: string
  modelRoutingPath?: string
  heartbeatFilePath?: string
  maxBudgetUsd?: number
  /** Missing providers intentionally keep approved child dispatch unavailable. */
  approvedDecisionDispatchEnabled?: boolean
  approvedDecisionAuthority?: ApprovedCloudDecisionAuthority
  approvedIntentCredentialAuthority?: IntentBridgeCredentialAuthority
  approvedIntentDobiusExecutablePath?: string
  approvedIntentInvoke?: IntentBridgeCall
  /** Constructor-only synthetic seams; production main does not provide these values. */
  dobiusClient?: ServiceDobiusClient
  projectRegistry?: ProjectRegistry
  orchestrationAlerts?: OrchestrationAlertsConfig
  /** Synthetic lifecycle tests can capture a handler without opening a socket. */
  testServer?: {
    create: (handler: (request: IncomingMessage, response: ServerResponse) => void) => Server
    listen: (server: Server, port: number) => Promise<void>
  }
}

export type ServiceDobiusClient = Pick<DobiusClient,
  'status' | 'worktreePs' | 'terminalList' | 'terminalShow' | 'terminalRead' | 'terminalSend' | 'terminalClose' |
  'terminalWait' | 'repoShow' | 'repoSearchRefs' | 'worktreeList' | 'worktreeCreate' | 'terminalCreate'>

async function closeServerBounded(server: Server, timeoutMs: number): Promise<boolean> {
  if (!server.listening) return true
  let finish!: (closed: boolean) => void
  const closed = new Promise<boolean>((resolve) => { finish = resolve })
  try { server.close((error) => finish(!error)) } catch { return false }
  let timer: NodeJS.Timeout | undefined
  const result = await Promise.race([
    closed,
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); timer.unref() })
  ])
  if (timer) clearTimeout(timer)
  if (result) return true
  // Stop shares one deadline across provider drain, HTTP close, and handlers.
  server.closeAllConnections()
  return false
}

// Agent types a worker_launch measurement applies to. Keyed by adapter so
// compile() can select('worker_launch') per request.agentType.
export const WORKER_LAUNCH_AGENT_TYPES = ['codex', 'claude'] as const

// Conservative mapping: worker_launch is read_only_verified (4) ONLY when BOTH
// dobius/runtime AND dobius/terminal_read reached >= 4 in the same doctor pass;
// any other outcome records 0 so launches fail closed instead of inheriting a
// stale green.
export function workerLaunchDoctorChecks(params: {
  checkedAt: string
  expiresAt: string
  runtimeVerified: boolean
  terminalReadVerified: boolean
}): Array<CapabilityCheck & { capability: 'worker_launch' }> {
  const verified = params.runtimeVerified && params.terminalReadVerified
  const level: ReadinessLevel = verified ? 4 : 0
  return WORKER_LAUNCH_AGENT_TYPES.map((agentType) => ({
    adapter: agentType,
    capability: 'worker_launch',
    level,
    checkedAt: params.checkedAt,
    expiresAt: params.expiresAt,
    evidence: verified
      ? ['derived from dobius/runtime=read_only_verified(4) + dobius/terminal_read=read_only_verified(4), same doctor pass']
      : ['worker_launch withheld: dobius/runtime and/or dobius/terminal_read below read_only_verified in this doctor pass'],
    ...(verified ? {} : {
      error: {
        code: 'worker_launch_unverified',
        message: 'doctor pass did not verify dobius/runtime and dobius/terminal_read at read_only_verified'
      }
    })
  }))
}

function tokenFor(dataDir: string): string {
  const path = join(dataDir, 'service-token')
  if (existsSync(path)) return readFileSync(path, 'utf8').trim()
  const token = randomBytes(32).toString('hex')
  writeFileSync(path, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
  return token
}

async function readJson(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > limit) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify(body)}\n`)
}

function authorized(req: IncomingMessage, token: string): boolean {
  return req.headers.authorization === `Bearer ${token}`
}

export class AdamService {
  readonly db: AdamDatabase
  readonly awareness: SessionAwareness
  readonly sessionMonitor: SessionMonitor
  readonly imessageGateway: IMessageCommandGateway
  readonly orchestrator: AuthoritativeOrchestrationSupervisor
  readonly capabilities: CapabilityRegistry
  readonly supervisor: AdamSupervisor
  readonly terminalDispatcher: TerminalDispatcher
  readonly terminalResolver: ProjectTerminalResolver
  readonly workerPreflight: WorkerPreflightPlanner
  readonly workerLauncher: WorkerLauncher
  readonly modelRouter: OmniRouteModelRouter | undefined
  readonly jobs: JobStore
  readonly cloudReceipts: DobiusCloudReceiptStore
  readonly approvedDecisionPublisher: ApprovedDecisionPublisher | undefined
  readonly heartbeat: ChannelHeartbeat
  readonly imessageModelClassifier: IMessageModelClassifier
  readonly imessageConversationFrames: IMessageConversationFrameManager
  readonly token: string
  private timer: NodeJS.Timeout | undefined
  private orchestrationTimer: NodeJS.Timeout | undefined
  private heartbeatTimer: NodeJS.Timeout | undefined
  private approvedDecisionTimer: NodeJS.Timeout | undefined
  private approvedDecisionStartupRecovery: Promise<unknown> | undefined
  private server: ReturnType<typeof createServer> | undefined
  private stopping = false
  private databaseClosed = false
  private lastAwareness: { at: string; result?: unknown; error?: string } | null = null
  private reconcilePromise: Promise<unknown> | undefined
  private readonly activeCallbacks = new Set<Promise<unknown>>()
  private readonly dobius: ServiceDobiusClient
  private readonly promptProfiles: Record<string, PromptProfile>
  private readonly alertRecipient: string
  // The canonical project registry, loaded once. Authoritative for the context
  // handshake that gates every writable dispatch and worker launch.
  private readonly projectRegistry: ProjectRegistry

  constructor(private readonly options: ServiceOptions) {
    // Fail loud before any side effect: without a recipient, monitors and
    // heartbeat outbox messages would silently have nowhere to go.
    this.alertRecipient = (options.orchestrationAlerts ?? loadOrchestrationAlertsConfig()).recipient
    mkdirSync(options.dataDir, { recursive: true })
    this.db = openDatabase(join(options.dataDir, 'adam.sqlite'))
    this.jobs = new JobStore(this.db)
    this.cloudReceipts = new DobiusCloudReceiptStore(this.db)
    this.approvedDecisionPublisher = createApprovedDecisionPublisher({
      enabled: options.approvedDecisionDispatchEnabled === true,
      database: this.db,
      receipts: this.cloudReceipts,
      decisionAuthority: options.approvedDecisionAuthority!,
      credentialAuthority: options.approvedIntentCredentialAuthority!,
      dobiusExecutablePath: options.approvedIntentDobiusExecutablePath,
      invoke: options.approvedIntentInvoke
    })
    this.imessageModelClassifier = new IMessageModelClassifier(this.db)
    this.imessageConversationFrames = new IMessageConversationFrameManager(this.db)
    this.token = tokenFor(options.dataDir)
    this.dobius = options.dobiusClient ?? new DobiusClient()
    this.projectRegistry = options.projectRegistry ?? loadProjectRegistry()
    this.promptProfiles = options.promptProfilesPath ? loadPromptProfiles(options.promptProfilesPath) : {}
    this.awareness = new SessionAwareness(this.db, this.dobius)
    this.sessionMonitor = new SessionMonitor(this.db, this.dobius)
    this.imessageGateway = new IMessageCommandGateway(this.db, this.sessionMonitor)
    this.capabilities = new CapabilityRegistry(this.db)
    this.supervisor = new AdamSupervisor(this.db, this.awareness, options.commitmentsPath)
    this.terminalDispatcher = new TerminalDispatcher(this.db, this.dobius)
    this.terminalResolver = new ProjectTerminalResolver(this.dobius)
    this.workerPreflight = new WorkerPreflightPlanner(this.dobius)
    this.workerLauncher = new WorkerLauncher(this.db, this.dobius, this.terminalDispatcher)
    this.orchestrator = new AuthoritativeOrchestrationSupervisor(
      this.db, this.workerPreflight, this.workerLauncher, this.dobius,
      options.orchestrationAlerts ?? loadOrchestrationAlertsConfig(),
      options.maxBudgetUsd !== undefined ? { maxBudgetUsd: options.maxBudgetUsd } : {},
      this.projectRegistry
    )
    this.modelRouter = options.modelRoutingPath
      ? new OmniRouteModelRouter(this.db, loadModelRoutingConfig(options.modelRoutingPath))
      : undefined
    this.heartbeat = new ChannelHeartbeat(this.jobs, (channel) => {
      const row = this.db.prepare('SELECT MAX(COALESCE(sent_at, delivered_at)) AS t FROM outbox WHERE channel = ? AND state = \'delivered\'').get(channel) as { t: string | null }
      return row.t ?? null
    }, {
      recipient: this.alertRecipient,
      heartbeatFile: options.heartbeatFilePath ?? 'HEARTBEAT.md'
    })
  }

  async reconcile(): Promise<unknown> {
    if (this.reconcilePromise) return this.reconcilePromise
    this.reconcilePromise = (async () => {
      try {
        const awareness = await this.awareness.reconcile()
        const monitors = await this.sessionMonitor.reconcile()
        const result = { awareness, monitors }
        this.lastAwareness = { at: new Date().toISOString(), result }
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.lastAwareness = { at: new Date().toISOString(), error: message }
        throw error
      } finally {
        this.reconcilePromise = undefined
      }
    })()
    return this.reconcilePromise
  }

  async start(): Promise<void> {
    if (this.stopping) throw new Error('service is stopping')
    // Availability must not depend on a slow external adapter. Open the local
    // authenticated control plane first, then reconcile Dobius asynchronously.
    const serverFactory = this.options.testServer?.create ?? createServer
    this.server = serverFactory((req, res) => {
      void this.trackCallback(this.handle(req, res)).catch(() => undefined)
    })
    this.server.requestTimeout = 10_000
    this.server.headersTimeout = 10_000
    this.server.keepAliveTimeout = 1_000
    if (this.options.testServer) {
      await this.options.testServer.listen(this.server, this.options.port)
    } else {
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject)
        this.server!.listen(this.options.port, '127.0.0.1', resolve)
      })
    }
    void this.trackCallback(this.doctorCapabilities()).catch(() => undefined)
    void this.trackCallback(this.reconcile()).catch(() => undefined)
    const interval = this.options.awarenessIntervalMs ?? 60_000
    this.timer = setInterval(() => void this.trackCallback(this.reconcile()).catch(() => undefined), interval)
    this.timer.unref()
    this.orchestrationTimer = setInterval(() => void this.trackCallback(this.orchestrator.tickAll()).catch(() => undefined), 5_000)
    this.orchestrationTimer.unref()
    this.heartbeatTimer = setInterval(() => {
      try {
        this.heartbeat.runPass()
      } catch (error) {
        console.error(`heartbeat pass failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }, 15 * 60_000)
    this.heartbeatTimer.unref()
    if (this.approvedDecisionPublisher) {
      this.approvedDecisionStartupRecovery = this.approvedDecisionPublisher.recover()
      void this.approvedDecisionStartupRecovery.catch(() => undefined)
      this.approvedDecisionTimer = setInterval(() => void this.approvedDecisionPublisher!.recover().catch(() => undefined),
        APPROVED_DECISION_RECOVERY_INTERVAL_MS)
      this.approvedDecisionTimer.unref()
    }
  }

  get boundPort(): number | undefined {
    const address = this.server?.address()
    return address && typeof address === 'object' ? address.port : undefined
  }

  async stop(timeoutMs = 20_000): Promise<boolean> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) return false
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    if (this.orchestrationTimer) clearInterval(this.orchestrationTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.approvedDecisionTimer) clearInterval(this.approvedDecisionTimer)
    // Publisher cancellation begins before waiting on HTTP close; handlers then unwind.
    const approvedDrain = this.approvedDecisionPublisher?.stop(timeoutMs) ?? Promise.resolve(true)
    const httpDrain = this.server ? closeServerBounded(this.server, timeoutMs) : Promise.resolve(true)
    const callbackDrain = this.drainCallbacks(timeoutMs)
    let deadlineTimer: NodeJS.Timeout | undefined
    const drained = await Promise.race([
      Promise.all([approvedDrain, httpDrain, callbackDrain]).then((results) => results.every(Boolean)),
      new Promise<boolean>((resolve) => { deadlineTimer = setTimeout(() => resolve(false), timeoutMs); deadlineTimer.unref() })
    ])
    if (deadlineTimer) clearTimeout(deadlineTimer)
    if (drained && !this.databaseClosed) {
      this.db.close()
      this.databaseClosed = true
    } else if (!drained) {
      process.stderr.write('ADAM shutdown incomplete; shared database retained while approved work or HTTP handlers remain unsettled\n')
    }
    return drained
  }

  private trackCallback<T>(callback: Promise<T>): Promise<T> {
    this.activeCallbacks.add(callback)
    void callback.then(
      () => this.activeCallbacks.delete(callback),
      () => this.activeCallbacks.delete(callback)
    )
    return callback
  }

  private async drainCallbacks(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (this.activeCallbacks.size > 0) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return false
      const settled = Promise.allSettled(this.activeCallbacks).then(() => true)
      let timer: NodeJS.Timeout | undefined
      const drained = await Promise.race([
        settled,
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), remaining); timer.unref() })
      ])
      if (timer) clearTimeout(timer)
      if (!drained) return false
    }
    return true
  }

  // Resolve the context pack for a write path, or send a 403 and return
  // undefined. The check itself is pure (checkContextHandshake); this only
  // adds the HTTP refusal. Shared with the read-only /v1/context-handshake.
  private resolvePackForWrite(
    res: ServerResponse,
    worktreePath: string,
    intent: 'dispatch' | 'launch',
    readinessLevel?: number
  ): ContextPack | undefined {
    const check = checkContextHandshake({
      registry: this.projectRegistry,
      worktreePath,
      intent,
      ...(readinessLevel !== undefined ? { readinessLevel } : {})
    })
    if (check.ok) return check.pack
    send(res, 403, { ok: false, error: 'context handshake failed', ...(check.code ? { code: check.code } : {}), reason: check.reason })
    return undefined
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/health') {
        send(res, 200, { ok: true, service: 'adam', mode: this.runtimeMode() })
        return
      }
      if (!authorized(req, this.token)) {
        send(res, 401, { ok: false, error: 'unauthorized' })
        return
      }
      if (this.stopping && req.method !== 'GET') {
        send(res, 503, { ok: false, error: 'service is stopping' })
        return
      }
      if (req.method === 'POST' && (url.pathname === '/v1/dobius/cloud-job-bindings/consume' ||
          url.pathname === '/v1/dobius/cloud-job-receipts')) {
        try {
          const body = await readJson(req, 64 * 1024)
          const result = url.pathname.endsWith('/consume')
            ? this.cloudReceipts.consume(body) : this.cloudReceipts.receive(body)
          send(res, 200, result)
        } catch (error) {
          if (!(error instanceof CloudReceiptError)) {
            send(res, error instanceof SyntaxError ? 400 : 500, { ok: false, error: 'receipt request unavailable' })
            return
          }
          const status = error.code === 'invalid' ? 400 : error.code === 'missing' ? 404 : 409
          send(res, status, { ok: false, error: error.code })
        }
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/internal/dobius/approved-decisions/dispatch') {
        if (!this.approvedDecisionPublisher) {
          send(res, 503, { ok: false, error: 'approved decision dispatch unavailable' })
          return
        }
        const body = await readJson(req, 2048)
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).length !== 1 || typeof (body as Record<string, unknown>).decisionId !== 'string') {
          send(res, 400, { ok: false, error: 'invalid approved decision dispatch request' })
          return
        }
        if (this.stopping) {
          send(res, 503, { ok: false, error: 'approved decision dispatch unavailable' })
          return
        }
        await this.approvedDecisionStartupRecovery?.catch(() => undefined)
        if (this.stopping) {
          send(res, 503, { ok: false, error: 'approved decision dispatch unavailable' })
          return
        }
        try {
          const result = await this.approvedDecisionPublisher.dispatch((body as { decisionId: string }).decisionId)
          send(res, 200, { ok: true, result })
        } catch {
          send(res, 409, { ok: false, error: 'approved decision unavailable' })
        }
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/snapshot') {
        send(res, 200, { ok: true, ...this.snapshot() })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/imessage/model-decision') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson' || typeof body.messageId !== 'string' || typeof body.text !== 'string' || !body.text.trim()) {
          send(res, 400, { ok: false, error: 'Carson sender, messageId, and text are required' })
          return
        }
        send(res, 200, { ok: true, decision: this.imessageModelClassifier.decide(body.messageId, body.text, typeof body.frameMode === 'string' ? body.frameMode : undefined) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/imessage/conversation-frame') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson' || typeof body.messageId !== 'string' || typeof body.text !== 'string' || !body.text.trim()) {
          send(res, 400, { ok: false, error: 'Carson sender, messageId, and text are required' })
          return
        }
        send(res, 200, { ok: true, frame: this.imessageConversationFrames.update('carson', body.messageId, body.text) })
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
        send(res, 200, { ok: true, capabilities: this.capabilities.latest() })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/capabilities/doctor') {
        send(res, 200, { ok: true, capabilities: await this.doctorCapabilities() })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/reconcile') {
        send(res, 200, { ok: true, result: await this.reconcile() })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/events/ingest') {
        const parsed = DobiusEventSchema.safeParse(await readJson(req))
        if (!parsed.success) {
          send(res, 400, { ok: false, error: 'invalid Dobius event', issues: parsed.error.issues })
          return
        }
        send(res, 200, { ok: true, result: ingestDobiusEvent(this.db, parsed.data) })
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/terminals') {
        const result = await this.dobius.terminalList(100)
        send(res, 200, {
          ok: true,
          terminals: result.terminals.map((terminal) => ({
            handle: terminal.handle,
            worktreeId: terminal.worktreeId,
            worktreePath: terminal.worktreePath,
            title: terminal.title,
            connected: terminal.connected,
            writable: terminal.writable,
            branch: terminal.branch,
            lastOutputAt: terminal.lastOutputAt
          }))
        })
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/session-monitors') {
        send(res, 200, { ok: true, monitors: this.sessionMonitor.list() })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/imessage/command') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson' || typeof body.messageId !== 'string' || typeof body.text !== 'string') {
          send(res, 400, { ok: false, error: 'Carson sender, messageId, and text are required' })
          return
        }
        const result = this.imessageGateway.handle({
          messageId: body.messageId, text: body.text,
          ...(typeof body.rowid === 'number' ? { rowid: body.rowid } : {})
        })
        send(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/approvals/prepare') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson' || typeof body.actionKind !== 'string' || typeof body.preview !== 'string' || !('payload' in body)) {
          send(res, 400, { ok: false, error: 'Carson sender, actionKind, preview, and payload are required' })
          return
        }
        const result = this.imessageGateway.prepareApproval({
          actionKind: body.actionKind, preview: body.preview, payload: body.payload,
          ...(typeof body.sourceMessageId === 'string' ? { sourceMessageId: body.sourceMessageId } : {})
        })
        send(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/approvals/executed') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson' || typeof body.actionDigest !== 'string' || !('evidence' in body)) {
          send(res, 400, { ok: false, error: 'Carson sender, actionDigest, and evidence are required' })
          return
        }
        const executed = this.imessageGateway.markApprovalExecuted(body.actionDigest, body.evidence)
        send(res, executed ? 200 : 409, { ok: executed, executed })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/imessage/action-outcome') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson' || typeof body.commandIntentId !== 'string' || typeof body.action !== 'string'
            || typeof body.passed !== 'boolean' || !('receipt' in body)) {
          send(res, 400, { ok: false, error: 'Carson sender, commandIntentId, action, passed, and receipt are required' })
          return
        }
        const result = this.imessageGateway.recordActionOutcome({
          commandIntentId: body.commandIntentId, action: body.action, passed: body.passed, receipt: body.receipt
        })
        send(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/orchestration/jobs') {
        const parsed = OrchestrationJobRequestSchema.safeParse(await readJson(req))
        if (!parsed.success) {
          send(res, 400, { ok: false, error: 'invalid orchestration job request', issues: parsed.error.issues })
          return
        }
        const result = this.orchestrator.compile(parsed.data)
        send(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/converse') {
        const body = (await readJson(req)) as Record<string, unknown>
        const utterance = typeof body.utterance === 'string' ? body.utterance.trim() : ''
        if (!utterance || utterance.length > 2000) {
          send(res, 400, { ok: false, error: 'utterance is required (1-2000 characters)' })
          return
        }
        send(res, 200, {
          ok: true,
          result: handleUtterance(utterance, { db: this.db, compile: (request) => this.orchestrator.compile(request) })
        })
        return
      }
      const orchestrationMatch = url.pathname.match(/^\/v1\/orchestration\/jobs\/([^/]+)(?:\/(tick|cancel))?$/)
      if (orchestrationMatch && req.method === 'GET' && !orchestrationMatch[2]) {
        send(res, 200, { ok: true, result: this.orchestrator.status(orchestrationMatch[1]!) })
        return
      }
      if (orchestrationMatch && req.method === 'POST' && orchestrationMatch[2] === 'tick') {
        send(res, 200, { ok: true, outcome: await this.orchestrator.tick(orchestrationMatch[1]!) })
        return
      }
      if (orchestrationMatch && req.method === 'POST' && orchestrationMatch[2] === 'cancel') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson' || typeof body.reason !== 'string') {
          send(res, 400, { ok: false, error: 'Carson sender and cancellation reason are required' })
          return
        }
        send(res, 200, { ok: true, result: await this.orchestrator.cancel(orchestrationMatch[1]!, body.reason) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/session-monitors') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson' || typeof body.terminalHandle !== 'string' || typeof body.worktreeId !== 'string') {
          send(res, 400, { ok: false, error: 'Carson sender, terminalHandle, and worktreeId are required' })
          return
        }
        const result = await this.sessionMonitor.watch({
          terminalHandle: body.terminalHandle, worktreeId: body.worktreeId,
          ...(typeof body.label === 'string' ? { label: body.label } : {}), recipient: this.alertRecipient
        })
        send(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/session-monitors/stop') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson' || typeof body.id !== 'string') {
          send(res, 400, { ok: false, error: 'Carson sender and monitor id are required' })
          return
        }
        send(res, 200, { ok: true, stopped: this.sessionMonitor.stop(body.id) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/session-snapshot') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson' || typeof body.terminalHandle !== 'string') {
          send(res, 400, { ok: false, error: 'Carson sender and terminalHandle are required' })
          return
        }
        const result = await this.sessionMonitor.snapshot(body.terminalHandle,
          typeof body.worktreeId === 'string' ? body.worktreeId : undefined)
        send(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/outbox/imessage-ready') {
        const row = this.db.prepare(`SELECT id, recipient, payload FROM outbox
          WHERE channel='imessage' AND state='pending' AND next_attempt_at <= ? ORDER BY created_at LIMIT 1`)
          .get(new Date().toISOString()) as { id: string; recipient: string; payload: string } | undefined
        send(res, 200, { ok: true, message: row ? { ...row, payload: JSON.parse(row.payload) } : null })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/outbox/imessage-enqueue') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'watcher' || typeof body.dedupeKey !== 'string' ||
            !body.dedupeKey.startsWith('pulse:') || typeof body.text !== 'string') {
          send(res, 400, { ok: false, error: 'watcher sender, pulse dedupe key, and text are required' })
          return
        }
        const text = body.text.trim()
        if (!text || text.length > 1800) {
          send(res, 400, { ok: false, error: 'text must contain 1-1800 characters' })
          return
        }
        const result = this.jobs.enqueueOutbox({
          dedupeKey: body.dedupeKey,
          channel: 'imessage',
          recipient: this.alertRecipient,
          payload: { text, source: 'heartbeat', pulse: body.pulse }
        })
        send(res, result.created ? 201 : 200, { ok: true, ...result })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/outbox/imessage-ack') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (typeof body.id !== 'string') { send(res, 400, { ok: false, error: 'id is required' }); return }
        const delivered = Number(this.db.prepare("UPDATE outbox SET state='delivered', delivered_at=? WHERE id=? AND state='pending'")
          .run(new Date().toISOString(), body.id).changes) === 1
        send(res, 200, { ok: true, delivered })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/terminal-resolve') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson') {
          send(res, 403, { ok: false, error: 'sender is not authorized' })
          return
        }
        try {
          const result = await this.terminalResolver.resolve({
            ...(typeof body.terminalHandle === 'string' ? { terminalHandle: body.terminalHandle } : {}),
            ...(typeof body.projectQuery === 'string' ? { projectQuery: body.projectQuery } : {}),
            ...(typeof body.terminalQuery === 'string' ? { terminalQuery: body.terminalQuery } : {})
          })
          send(res, 200, { ok: true, result })
        } catch (error) {
          if (error instanceof AmbiguousTerminalError) {
            send(res, 409, { ok: false, error: error.message, candidates: error.candidates })
            return
          }
          throw error
        }
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/context-handshake') {
        // Read-only admission probe: same check as the write routes, zero side
        // effects (no dispatch, no launch, no DB write, no capability record).
        let raw: unknown
        try {
          raw = await readJson(req)
        } catch (error) {
          send(res, 400, { ok: false, error: `invalid context handshake request: ${error instanceof Error ? error.message : String(error)}` })
          return
        }
        const parsed = ContextHandshakeRequestSchema.safeParse(raw)
        if (!parsed.success) {
          send(res, 400, { ok: false, error: 'invalid context handshake request', issues: parsed.error.issues })
          return
        }
        const { worktreePath, intent, readinessLevel } = parsed.data
        const pack = this.resolvePackForWrite(res, worktreePath, intent, readinessLevel)
        if (!pack) return
        send(res, 200, {
          ok: true,
          contextPack: { projectId: pack.projectId, digest: pack.digest, toolPolicyTier: pack.toolPolicyTier }
        })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/terminal-dispatch') {
        const parsed = TerminalDispatchRequestSchema.safeParse(await readJson(req))
        if (!parsed.success) {
          send(res, 400, { ok: false, error: 'invalid terminal dispatch request', issues: parsed.error.issues })
          return
        }
        const request = parsed.data
        const target = await this.dobius.terminalShow(request.target.terminalHandle)
        const paneKey = String(target.terminal.paneKey ?? '')
        const live = await this.dobius.worktreePs(100)
        const liveAgent = live.worktrees.flatMap((worktree) => worktree.agents)
          .find((agent) => agent.paneKey === paneKey)
        if (liveAgent?.state === 'working' && !request.allowInterrupt) {
          send(res, 409, { ok: false, error: 'target agent is working; queue or explicitly authorize interruption' })
          return
        }
        // Resolve the context pack from the terminal's OBSERVED worktree path
        // (never a caller-supplied name). Fail closed: no writable dispatch
        // without a passing handshake.
        const observedWorktreePath = String(target.terminal.worktreePath ?? '')
        const pack = this.resolvePackForWrite(res, observedWorktreePath, 'dispatch')
        if (!pack) return
        // The caller believes it is somewhere it is not: refuse, do not silently
        // correct. Only engineered prompts carry a caller-supplied projectId.
        if (request.prompt.mode === 'engineered' && request.prompt.targetContext.projectId !== pack.projectId) {
          send(res, 409, {
            ok: false, error: 'targetContext.projectId disagrees with the resolved project',
            claimed: request.prompt.targetContext.projectId, resolved: pack.projectId
          })
          return
        }
        const profile = request.prompt.mode === 'engineered' ? this.promptProfiles[request.prompt.profileId] : undefined
        // Literal prompts pass through unchanged. Engineered prompts get the
        // context pack appended so the agent is not blind to where it is.
        const rendered = renderPrompt(request.prompt, request.target, profile)
        const prompt = request.prompt.mode === 'engineered' ? `${rendered}\n\n${renderContextPack(pack)}` : rendered
        const prepared = await this.terminalDispatcher.prepare({
          terminalHandle: request.target.terminalHandle,
          worktreeId: request.target.worktreeId,
          prompt,
          idempotencyKey: request.dedupeKey,
          authorizedBy: request.authorization.authorizedBy,
          authorizationSource: request.authorization.source,
          promptMode: request.prompt.mode,
          contextPack: { digest: pack.digest, json: JSON.stringify(pack) }
        })
        const delivery = await this.terminalDispatcher.sendPrepared(prepared.id)
        const verification = await this.terminalDispatcher.verify(prepared.id)
        if (verification.passed) {
          const checkedAt = new Date()
          this.capabilities.record({
            adapter: 'dobius', capability: 'terminal_send', level: 6,
            checkedAt: checkedAt.toISOString(), expiresAt: new Date(checkedAt.getTime() + 24 * 60 * 60_000).toISOString(),
            evidence: [`dispatch:${prepared.id}`, `terminal:${request.target.terminalHandle}`, `prompt-digest:${prepared.promptDigest}`]
          })
        }
        send(res, verification.passed ? 200 : 422, {
          ok: verification.passed,
          result: {
            dispatchId: prepared.id,
            duplicate: !prepared.created,
            sentNow: delivery.sent,
            promptDigest: prepared.promptDigest,
            terminalHandle: request.target.terminalHandle,
            worktreeId: request.target.worktreeId,
            contextPack: { projectId: pack.projectId, digest: pack.digest, toolPolicyTier: pack.toolPolicyTier },
            verification
          }
        })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/workers/preflight') {
        const parsed = WorkerPreflightRequestSchema.safeParse(await readJson(req))
        if (!parsed.success) {
          send(res, 400, { ok: false, error: 'invalid worker preflight request', issues: parsed.error.issues })
          return
        }
        const result = await this.workerPreflight.plan(parsed.data)
        send(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/workers/launch') {
        const parsed = WorkerLaunchRequestSchema.safeParse(await readJson(req))
        if (!parsed.success) {
          send(res, 400, { ok: false, error: 'invalid worker launch request', issues: parsed.error.issues })
          return
        }
        const request = parsed.data
        const preflight = await this.workerPreflight.plan({
          repoSelector: request.repoSelector,
          fullHandoff: request.fullHandoff
        })
        const profile = this.promptProfiles[request.prompt.profileId]
        if (!profile) {
          send(res, 400, { ok: false, error: `unknown prompt profile: ${request.prompt.profileId}` })
          return
        }
        // Resolve the context pack from the repo's OBSERVED path. Fail closed:
        // this is the check that stops a worker being launched into a read_only
        // project such as PCIF.
        const launchPack = this.resolvePackForWrite(res, preflight.repo.path, 'launch')
        if (!launchPack) return
        const result = await this.workerLauncher.launch({
          idempotencyKey: request.dedupeKey,
          preflight,
          worktreeName: request.worktreeName,
          agentType: request.agentType,
          promptSource: request.prompt,
          contextPack: { digest: launchPack.digest, json: JSON.stringify(launchPack) },
          buildPrompt: (target) => renderPrompt({
            ...request.prompt,
            targetContext: {
              projectId: launchPack.projectId,
              projectName: launchPack.projectName,
              worktreePath: target.worktreePath,
              ...(target.branch ? { branch: target.branch } : {})
            }
          }, { terminalHandle: target.terminalHandle, worktreeId: target.worktreeId }, profile),
          setupPolicy: request.setupPolicy,
          authorizedBy: request.authorization.authorizedBy,
          authorizationSource: request.authorization.source
        })
        if (result.state === 'verified') {
          const checkedAt = new Date()
          const expiresAt = new Date(checkedAt.getTime() + 24 * 60 * 60_000).toISOString()
          for (const capability of ['worktree_create', 'agent_launch']) {
            this.capabilities.record({
              adapter: 'dobius', capability, level: 6,
              checkedAt: checkedAt.toISOString(), expiresAt,
              evidence: [`worker-launch:${result.id}`, `worktree:${result.worktreeId}`, `terminal:${result.terminalHandle}`]
            })
          }
        }
        send(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/models/route') {
        if (!this.modelRouter) {
          send(res, 503, { ok: false, error: 'model routing is not configured' })
          return
        }
        const parsed = ModelRouteRequestSchema.safeParse(await readJson(req))
        if (!parsed.success) {
          send(res, 400, { ok: false, error: 'invalid model route request', issues: parsed.error.issues })
          return
        }
        const result = await this.modelRouter.route(parsed.data)
        const checkedAt = new Date()
        this.capabilities.record({
          adapter: 'omniroute', capability: 'model_route', level: 6,
          checkedAt: checkedAt.toISOString(), expiresAt: new Date(checkedAt.getTime() + 60 * 60_000).toISOString(),
          evidence: [`model-route:${result.id}`, `requested:${result.requestedModel}`, `provider:${result.selectedProvider ?? 'unknown'}`]
        })
        send(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/prepare-tomorrow') {
        const body = (await readJson(req)) as Record<string, unknown>
        if (body.senderId !== 'carson') {
          send(res, 403, { ok: false, error: 'sender is not authorized' })
          return
        }
        const dedupeKey = typeof body.dedupeKey === 'string' ? body.dedupeKey : ''
        if (!dedupeKey) {
          send(res, 400, { ok: false, error: 'dedupeKey is required' })
          return
        }
        const commandText = typeof body.commandText === 'string' ? body.commandText : undefined
        const result = await this.supervisor.prepareTomorrow({
          channel: typeof body.channel === 'string' ? body.channel : 'api',
          senderId: 'carson',
          dedupeKey,
          ...(commandText ? { commandText } : {})
        })
        send(res, 200, { ok: true, result })
        return
      }
      if (req.method === 'POST' && url.pathname.startsWith('/v1/mode/')) {
        const mode = url.pathname.slice('/v1/mode/'.length)
        if (!['shadow', 'read_only', 'frozen'].includes(mode)) {
          send(res, 400, { ok: false, error: 'invalid mode' })
          return
        }
        this.setRuntimeMode(mode)
        send(res, 200, { ok: true, mode })
        return
      }
      send(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  private runtimeMode(): string {
    const row = this.db.prepare("SELECT value FROM system_state WHERE key = 'runtime_mode'").get() as { value: string }
    return row.value
  }

  private async doctorCapabilities(): Promise<Array<Record<string, unknown>>> {
    const checkedAt = new Date()
    const expiresAt = new Date(checkedAt.getTime() + 5 * 60_000).toISOString()
    let runtimeVerified = false
    let terminalReadVerified = false
    try {
      await this.dobius.status()
      this.capabilities.record({
        adapter: 'dobius', capability: 'runtime', level: 4,
        checkedAt: checkedAt.toISOString(), expiresAt, evidence: ['dobius status --json']
      })
      runtimeVerified = true
      await this.dobius.terminalList(1)
      this.capabilities.record({
        adapter: 'dobius', capability: 'terminal_read', level: 4,
        checkedAt: checkedAt.toISOString(), expiresAt, evidence: ['dobius terminal list --limit 1 --json']
      })
      terminalReadVerified = true
      const currentSend = this.capabilities.latest(checkedAt)
        .find((item) => item.adapter === 'dobius' && item.capability === 'terminal_send')
      if (Number(currentSend?.level ?? 0) < 5) {
        this.capabilities.record({
          adapter: 'dobius', capability: 'terminal_send', level: 2,
          checkedAt: checkedAt.toISOString(), expiresAt,
          evidence: ['typed adapter installed', 'live shadow-action proof pending']
        })
      }
    } catch (error) {
      this.capabilities.record({
        adapter: 'dobius', capability: 'runtime', level: 0,
        checkedAt: checkedAt.toISOString(), expiresAt, evidence: [],
        error: { code: 'doctor_failed', message: error instanceof Error ? error.message : String(error) }
      })
    }
    for (const check of workerLaunchDoctorChecks({
      checkedAt: checkedAt.toISOString(), expiresAt, runtimeVerified, terminalReadVerified
    })) {
      this.capabilities.record(check)
    }
    if (this.modelRouter) {
      const health = await this.modelRouter.health()
      this.capabilities.record({
        adapter: 'omniroute', capability: 'model_route', level: health.ok ? 4 : 2,
        checkedAt: checkedAt.toISOString(), expiresAt,
        evidence: health.ok ? ['GET /api/health/ping', 'active backend: omniroute'] : ['adapter configured', 'active backend: omniroute'],
        ...(!health.ok ? { error: { code: 'backend_unavailable', message: health.error ?? `HTTP ${health.status}` } } : {})
      })
    }
    return this.capabilities.latest(checkedAt)
  }

  private setRuntimeMode(mode: string): void {
    this.db.prepare("UPDATE system_state SET value = ?, updated_at = ? WHERE key = 'runtime_mode'")
      .run(mode, new Date().toISOString())
  }

  private snapshot(): Record<string, unknown> {
    const count = (table: string): number =>
      Number((this.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count)
    return {
      mode: this.runtimeMode(),
      integrity: databaseIntegrity(this.db),
      lastAwareness: this.lastAwareness,
      counts: {
        commands: count('commands'),
        jobs: count('jobs'),
        sessions: count('sessions'),
        events: count('events'),
        projects: count('project_ledger'),
        commitments: count('commitments'),
        pendingOutbox: Number(
          (this.db.prepare("SELECT count(*) AS count FROM outbox WHERE state != 'delivered'").get() as { count: number }).count
        )
      }
    }
  }
}
