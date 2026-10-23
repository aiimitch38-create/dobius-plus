import { z } from 'zod'
import { CloudId, CloudJobInput, CloudProject } from '../../../../shared/cloud-jobs'
import type { CloudJobPrincipal, CloudJobService } from '../../../automations/cloud-job-service'
import { defineMethod, type RpcContext, type RpcMethod } from '../core'

function authority(context: RpcContext): {
  service: CloudJobService
  principal: CloudJobPrincipal
} {
  if (!context.cloudJobs) {
    throw new Error('Cloud jobs authority is not configured on this host.')
  }
  const hasClient = context.clientId !== undefined
  const hasDevice = context.clientDeviceId !== undefined
  if (hasClient !== hasDevice || (hasClient && (!context.clientId || !context.clientDeviceId))) {
    throw new Error('Authenticated device identity is required for cloud jobs.')
  }
  if (!hasClient && context.authenticatedLocal !== true) {
    throw new Error('Authenticated local transport is required for cloud jobs administration.')
  }
  return {
    service: context.cloudJobs,
    principal:
      context.clientId === undefined
        ? { kind: 'local', id: 'local' }
        : { kind: 'paired', id: CloudId.parse(context.clientDeviceId) }
  }
}

const Window = z.object({ limit: z.number().int().min(1).max(200).default(200) }).strict()
const JobId = z.object({ id: CloudId }).strict()
const Change = JobId.extend({ version: z.number().int().positive() }).strict()

export const CLOUD_JOB_METHODS: readonly RpcMethod[] = [
  defineMethod({
    name: 'jobs.status',
    params: null,
    handler: (_params, context) => {
      if (!context.cloudJobs) {
        return { configured: false, dispatchEnabled: false, liveDispatchReady: false }
      }
      return context.cloudJobs.status()
    }
  }),
  defineMethod({
    name: 'jobs.list',
    params: Window,
    handler: async (params, context) => {
      const { service, principal } = authority(context)
      return { jobs: await service.list(principal, params.limit) }
    }
  }),
  defineMethod({
    name: 'jobs.snapshot',
    params: Window.extend({ cursor: z.string().min(1).max(1024).optional() }).strict(),
    handler: (params, context) => {
      const { service, principal } = authority(context)
      return service.snapshot(principal, params.limit, params.cursor)
    }
  }),
  defineMethod({
    name: 'jobs.get',
    params: JobId,
    handler: async (params, context) => {
      const { service, principal } = authority(context)
      return { job: await service.get(principal, params.id) }
    }
  }),
  defineMethod({
    name: 'jobs.events',
    params: Window.extend({ after: z.number().int().nonnegative().default(0) }).strict(),
    handler: (params, context) => {
      const { service, principal } = authority(context)
      return service.events(principal, params.after, params.limit)
    }
  }),
  defineMethod({
    name: 'jobs.submit',
    params: CloudJobInput,
    handler: async (params, context) => {
      const { service, principal } = authority(context)
      return { job: await service.submit(principal, params) }
    }
  }),
  defineMethod({
    name: 'jobs.cancel',
    params: Change,
    handler: async (params, context) => {
      const { service, principal } = authority(context)
      return { job: await service.cancel(principal, params.id, params.version) }
    }
  }),
  defineMethod({
    name: 'jobs.retry',
    params: Change,
    handler: async (params, context) => {
      const { service, principal } = authority(context)
      return { job: await service.retry(principal, params.id, params.version) }
    }
  }),
  defineMethod({
    name: 'jobs.registerProject',
    params: CloudProject,
    handler: (params, context) => {
      const { service, principal } = authority(context)
      service.registerProject(principal, params)
      return { registered: true }
    }
  }),
  defineMethod({
    name: 'jobs.setDispatch',
    params: z.object({ enabled: z.boolean() }).strict(),
    handler: (params, context) => {
      const { service, principal } = authority(context)
      service.setDispatchEnabled(principal, params.enabled)
      return service.status()
    }
  }),
  defineMethod({
    name: 'jobs.accept',
    params: Change.extend({ receiptId: CloudId }).strict(),
    handler: async (params, context) => {
      const { service, principal } = authority(context)
      return { job: await service.accept(principal, params.id, params.version, params.receiptId) }
    }
  })
]
