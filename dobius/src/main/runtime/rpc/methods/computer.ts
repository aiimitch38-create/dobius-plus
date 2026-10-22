import { z } from 'zod'
import {
  callComputerSidecarAction,
  callComputerSidecarCapabilities,
  callComputerSidecarListApps,
  callComputerSidecarListWindows,
  callComputerSidecarSnapshot,
  resetComputerSidecarForTest
} from '../../../computer/sidecar-client'
import { defineMethod, type RpcMethod } from '../core'
import {
  actionTargetKind,
  decideComputerAction,
  rememberComputerSnapshot
} from '../../../computer/action-decision'
import { journalComputerDecision } from '../../../computer/action-decision-journal'
import { RuntimeClientError } from '../../../computer/runtime-client-error'
import type { ComputerActionResult } from '../../../../shared/computer-use-runtime-types'
import {
  Click,
  ComputerObserveTarget,
  ComputerPermissions,
  Drag,
  Hotkey,
  ListApps,
  ListWindows,
  PasteText,
  PerformSecondaryAction,
  PressKey,
  Scroll,
  SetValue,
  TypeText
} from './computer-schemas'

export function resetComputerSessionsForTest(): void {
  resetComputerSidecarForTest()
}

type DecidedMethod = Parameters<typeof callComputerSidecarAction>[0]

/** Every agent action passes the decision point first; its verdict and outcome are journaled. */
async function runDecidedAction(
  method: DecidedMethod,
  params: Record<string, unknown>
): Promise<ComputerActionResult> {
  const decision = await decideComputerAction(method, params, {
    listWindows: callComputerSidecarListWindows
  })
  const entry = {
    method,
    app: String(params.app),
    target: actionTargetKind(method, params),
    verdict: decision.verdict,
    rule: decision.rule,
    source: decision.source
  }
  if (decision.verdict === 'block') {
    await journalComputerDecision({ ...entry, outcome: 'blocked' })
    throw new RuntimeClientError('invalid_argument', decision.reason)
  }
  const { confirmRisky: _confirmRisky, ...forwarded } = params
  try {
    const result = await callComputerSidecarAction(method, forwarded)
    rememberComputerSnapshot(params.app, result)
    await journalComputerDecision({ ...entry, outcome: 'ok' })
    return result
  } catch (error) {
    const errorCode = error instanceof RuntimeClientError ? error.code : 'unknown'
    await journalComputerDecision({ ...entry, outcome: 'error', errorCode })
    throw error
  }
}

export const COMPUTER_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'computer.capabilities',
    params: z.object({}),
    handler: async () => {
      return await callComputerSidecarCapabilities()
    }
  }),
  defineMethod({
    name: 'computer.listApps',
    params: ListApps,
    handler: async () => {
      return await callComputerSidecarListApps()
    }
  }),
  defineMethod({
    name: 'computer.permissions',
    params: ComputerPermissions,
    handler: async (params) => {
      const { openComputerUsePermissions } =
        await import('../../../computer/macos-computer-use-permissions')
      return openComputerUsePermissions(params.id)
    }
  }),
  defineMethod({
    name: 'computer.permissionsStatus',
    params: z.object({}),
    handler: async () => {
      const { getComputerUsePermissionStatus } =
        await import('../../../computer/macos-computer-use-permissions')
      return getComputerUsePermissionStatus()
    }
  }),
  defineMethod({
    name: 'computer.listWindows',
    params: ListWindows,
    handler: async (params) => {
      return await callComputerSidecarListWindows(params)
    }
  }),
  defineMethod({
    name: 'computer.getAppState',
    params: ComputerObserveTarget,
    handler: async (params) => {
      const result = await callComputerSidecarSnapshot(params)
      rememberComputerSnapshot(params.app, result)
      return result
    }
  }),
  defineMethod({
    name: 'computer.click',
    params: Click,
    handler: async (params) => {
      return await runDecidedAction('click', params)
    }
  }),
  defineMethod({
    name: 'computer.performSecondaryAction',
    params: PerformSecondaryAction,
    handler: async (params) => {
      return await runDecidedAction('performSecondaryAction', params)
    }
  }),
  defineMethod({
    name: 'computer.scroll',
    params: Scroll,
    handler: async (params) => {
      return await runDecidedAction('scroll', params)
    }
  }),
  defineMethod({
    name: 'computer.drag',
    params: Drag,
    handler: async (params) => {
      return await runDecidedAction('drag', params)
    }
  }),
  defineMethod({
    name: 'computer.typeText',
    params: TypeText,
    handler: async (params) => {
      return await runDecidedAction('typeText', params)
    }
  }),
  defineMethod({
    name: 'computer.pressKey',
    params: PressKey,
    handler: async (params) => {
      return await runDecidedAction('pressKey', params)
    }
  }),
  defineMethod({
    name: 'computer.hotkey',
    params: Hotkey,
    handler: async (params) => {
      return await runDecidedAction('hotkey', params)
    }
  }),
  defineMethod({
    name: 'computer.pasteText',
    params: PasteText,
    handler: async (params) => {
      return await runDecidedAction('pasteText', params)
    }
  }),
  defineMethod({
    name: 'computer.setValue',
    params: SetValue,
    handler: async (params) => {
      return await runDecidedAction('setValue', params)
    }
  })
]
