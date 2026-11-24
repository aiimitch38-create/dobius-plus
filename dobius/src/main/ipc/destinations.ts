import { ipcMain } from 'electron'
import type {
  Destination,
  DestinationSaveInput,
  DestinationTestResult
} from '../../shared/destinations'
import {
  deleteDestination,
  getDestination,
  listDestinations,
  saveDestination
} from '../destinations/destinations-store'
import { deliverToDestination } from '../destinations/destination-delivery'
import { approveImessageHandle } from '../imessage-bridge/approved-handles'

export function registerDestinationHandlers(): void {
  ipcMain.handle('destinations:list', (): Destination[] => listDestinations())
  ipcMain.handle(
    'destinations:save',
    async (_event, input: DestinationSaveInput): Promise<Destination> => {
      // Why: a destination's handle is texted by automations with no click, so Carson approves it once here.
      if (input?.type === 'imessage') {
        const handle = input.config?.handle
        const refused = await approveImessageHandle(typeof handle === 'string' ? handle : '')
        if (refused) {
          throw new Error(refused)
        }
      }
      return saveDestination(input)
    }
  )
  ipcMain.handle('destinations:delete', (_event, id: string): boolean => deleteDestination(id))
  ipcMain.handle(
    'destinations:test',
    async (_event, id: string): Promise<DestinationTestResult> => {
      const destination = getDestination(id)
      if (!destination) {
        return { ok: false, error: 'Destination not found' }
      }
      try {
        await deliverToDestination(destination, {
          title: `Dobius+ test — ${destination.name}`,
          body: 'This destination is wired up. Automation results will arrive here.'
        })
        return { ok: true, error: null }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
}
