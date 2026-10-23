// Why: the dispatcher is the one place that knows how to turn a validated
// RPC request into a response envelope. Splitting it from the transport
// makes it unit-testable without spinning up a socket, and keeps
// runtime-rpc.ts focused on framing/auth/connection bookkeeping.
import {
  ZodError,
  InvalidArgumentError,
  buildRegistry,
  formatZodError,
  isStreamingMethod,
  type RpcAnyMethod,
  type RpcEnvelopeMeta,
  type RpcRegistry,
  type RpcRequest,
  type RpcResponse
} from './core'
import type { TerminalStreamFrame } from '../../../shared/terminal-stream-protocol'
import type { FeatureInteractionId } from '../../../shared/feature-interactions'
import {
  computerErrorData,
  errorResponse,
  mapBrowserError,
  mapEmulatorError,
  mapRuntimeError,
  successResponse
} from './errors'
import { ALL_RPC_METHODS } from './methods'
import { emulatorProbe, emulatorProbeError } from '../../emulator/emulator-probe'
import type { DobiusRuntimeService } from '../dobius-runtime'
import type { CloudJobService } from '../../automations/cloud-job-service'
import type { SystemMonitorService } from '../../system-monitor/service'
import type { ApplicationDataCatalog } from '../../storage/data-catalog/application-catalog'
import type { AdamCloudIntentBridge } from '../../adam-service-principal/adam-cloud-intent-bridge'
import type { LocalCatalogPreviewConnection } from '../../ipc/data-catalog-preview-lifecycle'
import { recordRuntimeFeatureInteraction } from './dispatch-feature-interaction'
import {
  localWebContentsPreviewPrincipal,
  websocketPreviewPrincipal
} from './dispatch-preview-principal'

export type DispatcherOptions = {
  runtime: DobiusRuntimeService
  cloudJobs?: CloudJobService
  systemMonitor?: SystemMonitorService
  dataCatalog?: ApplicationDataCatalog
  adamCloudIntentBridge?: AdamCloudIntentBridge
  methods?: readonly RpcAnyMethod[]
}

export class RpcDispatcher {
  private readonly runtime: DobiusRuntimeService
  private readonly registry: RpcRegistry
  private readonly cloudJobs?: CloudJobService
  private readonly systemMonitor?: SystemMonitorService
  private readonly dataCatalog?: ApplicationDataCatalog
  private readonly adamCloudIntentBridge?: AdamCloudIntentBridge

  constructor({
    runtime,
    cloudJobs,
    systemMonitor,
    dataCatalog,
    adamCloudIntentBridge,
    methods = ALL_RPC_METHODS
  }: DispatcherOptions) {
    this.runtime = runtime
    this.cloudJobs = cloudJobs
    this.systemMonitor = systemMonitor
    this.dataCatalog = dataCatalog
    this.adamCloudIntentBridge = adamCloudIntentBridge
    this.registry = buildRegistry(methods)
  }

  async dispatch(
    request: RpcRequest,
    options?: {
      signal?: AbortSignal
      authenticatedLocal?: true
      authenticatedLocalSocket?: true
      adamPeerEvidence?: object
      localPreviewConnection?: LocalCatalogPreviewConnection
    }
  ): Promise<RpcResponse> {
    const meta = this.meta()
    const method = this.registry.get(request.method)
    if (!method) {
      return errorResponse(
        request.id,
        meta,
        'method_not_found',
        `Unknown method: ${request.method}`
      )
    }

    const parsedParams = this.parseParams(request, method, meta)
    if (parsedParams.error) {
      return parsedParams.error
    }

    // Why: streaming methods are not supported over one-shot transports like
    // Unix sockets. They require a reply function that can be called multiple
    // times, which is only available via dispatchStreaming.
    if (isStreamingMethod(method)) {
      return errorResponse(
        request.id,
        meta,
        'method_not_supported',
        `Method ${request.method} requires a streaming transport`
      )
    }

    const isEmulator = request.method.startsWith('emulator.')
    if (isEmulator) {
      emulatorProbe(`rpc ${request.method}`, request.params)
    }
    try {
      const result = await method.handler(parsedParams.value, {
        runtime: this.runtime,
        cloudJobs: this.cloudJobs,
        adamCloudIntentBridge: this.adamCloudIntentBridge,
        adamPeerEvidence: options?.adamPeerEvidence,
        systemMonitor: this.systemMonitor,
        dataCatalog: this.dataCatalog,
        authenticatedLocal: options?.authenticatedLocal,
        authenticatedLocalSocket: options?.authenticatedLocalSocket,
        catalogPreviewPrincipal: options?.localPreviewConnection
          ? localWebContentsPreviewPrincipal(this.runtime, options.localPreviewConnection)
          : undefined,
        connectionSignal: options?.localPreviewConnection?.signal,
        connectionId: options?.localPreviewConnection?.connectionId,
        signal: options?.signal
      })
      this.recordRuntimeFeatureInteraction(request.method, result, undefined, request.params)
      return successResponse(request.id, meta, result)
    } catch (error) {
      if (isEmulator) {
        emulatorProbeError(`rpc ${request.method}`, error, { params: request.params })
      }
      return this.mapError(request, meta, error)
    }
  }

  // Why: streaming dispatch sends multiple responses through the reply callback
  // instead of returning a single Promise. This enables terminal.subscribe and
  // other subscription-style methods that push data over time.
  async dispatchStreaming(
    request: RpcRequest,
    reply: (response: string) => void,
    options?: {
      connectionId?: string
      signal?: AbortSignal
      connectionSignal?: AbortSignal
      clientId?: string
      clientDeviceId?: string
      clientKind?: 'mobile' | 'runtime'
      sendBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
      registerBinaryStreamHandler?: (
        streamId: number,
        handler: (frame: TerminalStreamFrame) => void
      ) => () => void
    }
  ): Promise<void> {
    const meta = this.meta()
    const method = this.registry.get(request.method)
    if (!method) {
      reply(
        JSON.stringify(
          errorResponse(request.id, meta, 'method_not_found', `Unknown method: ${request.method}`)
        )
      )
      return
    }

    const parsedParams = this.parseParams(request, method, meta)
    if (parsedParams.error) {
      reply(JSON.stringify(parsedParams.error))
      return
    }

    if (!isStreamingMethod(method)) {
      try {
        const result = await method.handler(parsedParams.value, {
          runtime: this.runtime,
          cloudJobs: this.cloudJobs,
          systemMonitor: this.systemMonitor,
          dataCatalog: this.dataCatalog,
          signal: options?.signal,
          connectionSignal: options?.connectionSignal,
          requestId: request.id,
          connectionId: options?.connectionId,
          catalogPreviewPrincipal: websocketPreviewPrincipal(this.runtime, options ?? {}),
          clientId: options?.clientId,
          clientDeviceId: options?.clientDeviceId,
          clientKind: options?.clientKind,
          sendBinary: options?.sendBinary,
          registerBinaryStreamHandler: options?.registerBinaryStreamHandler
        })
        this.recordRuntimeFeatureInteraction(request.method, result, undefined, request.params)
        reply(JSON.stringify(successResponse(request.id, meta, result)))
      } catch (error) {
        reply(JSON.stringify(this.mapError(request, meta, error)))
      }
      return
    }

    const recordedStreamingFeatureInteractions = new Set<FeatureInteractionId>()
    const emit = (result: unknown): void => {
      this.recordRuntimeFeatureInteraction(
        request.method,
        result,
        recordedStreamingFeatureInteractions,
        request.params
      )
      const response = successResponse(request.id, meta, result)
      response.streaming = true
      reply(JSON.stringify(response))
    }

    try {
      const result = await method.handler(
        parsedParams.value,
        {
          runtime: this.runtime,
          cloudJobs: this.cloudJobs,
          systemMonitor: this.systemMonitor,
          dataCatalog: this.dataCatalog,
          signal: options?.signal,
          connectionSignal: options?.connectionSignal,
          requestId: request.id,
          connectionId: options?.connectionId,
          catalogPreviewPrincipal: websocketPreviewPrincipal(this.runtime, options ?? {}),
          clientId: options?.clientId,
          clientDeviceId: options?.clientDeviceId,
          clientKind: options?.clientKind,
          sendBinary: options?.sendBinary,
          registerBinaryStreamHandler: options?.registerBinaryStreamHandler
        },
        emit
      )
      this.recordRuntimeFeatureInteraction(
        request.method,
        result,
        recordedStreamingFeatureInteractions,
        request.params
      )
    } catch (error) {
      reply(JSON.stringify(this.mapError(request, meta, error)))
    }
  }

  private parseParams(
    request: RpcRequest,
    method: RpcAnyMethod,
    meta: RpcEnvelopeMeta
  ): { value: unknown; error?: undefined } | { value?: undefined; error: RpcResponse } {
    if (method.params === null) {
      return { value: undefined }
    }
    const rawParams = request.params ?? {}
    const result = method.params.safeParse(rawParams)
    if (!result.success) {
      return {
        error: this.invalidArgumentResponse(request, meta, formatZodError(result.error))
      }
    }
    return { value: result.data }
  }

  private mapError(request: RpcRequest, meta: RpcEnvelopeMeta, error: unknown): RpcResponse {
    if (error instanceof ZodError) {
      return this.invalidArgumentResponse(request, meta, formatZodError(error))
    }
    if (error instanceof InvalidArgumentError) {
      return this.invalidArgumentResponse(request, meta, error.message)
    }

    // Why: browser methods throw BrowserError with a structured `code`;
    // every other runtime error has a plain-message code. Routing by method
    // prefix keeps the mapping a single decision rather than a per-method
    // flag callers must remember to set.
    if (request.method.startsWith('browser.')) {
      return mapBrowserError(request.id, meta, error)
    }
    if (request.method.startsWith('emulator.')) {
      return mapEmulatorError(request.id, meta, error)
    }
    return mapRuntimeError(request.id, meta, error)
  }

  private invalidArgumentResponse(
    request: RpcRequest,
    meta: RpcEnvelopeMeta,
    message: string
  ): RpcResponse {
    return errorResponse(
      request.id,
      meta,
      'invalid_argument',
      message,
      request.method.startsWith('computer.') ? computerErrorData('invalid_argument') : undefined
    )
  }

  private meta(): RpcEnvelopeMeta {
    return { runtimeId: this.runtime.getRuntimeId() }
  }

  private recordRuntimeFeatureInteraction(
    method: string,
    result: unknown,
    alreadyRecorded?: Set<FeatureInteractionId>,
    rawParams?: unknown
  ): void {
    recordRuntimeFeatureInteraction(this.runtime, method, result, alreadyRecorded, rawParams)
  }
}
