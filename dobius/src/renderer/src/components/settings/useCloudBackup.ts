import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CloudBackupApi,
  CloudBackupConnection,
  CloudBackupStatus
} from '../../../../shared/cloud-backup'

export function useCloudBackup(api?: CloudBackupApi) {
  const [status, setStatus] = useState<CloudBackupStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(false)
  const working = useRef(false)
  useEffect(() => {
    mounted.current = true
    if (!api) {
      return () => {
        mounted.current = false
      }
    }
    let reading = false
    const refresh = async (): Promise<void> => {
      if (reading || working.current) {
        return
      }
      reading = true
      try {
        const next = await api.getStatus()
        if (mounted.current) {
          setStatus(next)
        }
      } catch {
        if (mounted.current) {
          setError('Backup status could not be loaded. Reopen settings to retry.')
        }
      } finally {
        reading = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [api])

  const perform = useCallback(
    async (action: () => Promise<CloudBackupStatus | boolean>): Promise<void> => {
      if (working.current) {
        return
      }
      working.current = true
      setBusy(true)
      setError('')
      setNotice('')
      try {
        const result = await action()
        if (mounted.current) {
          if (typeof result === 'boolean') {
            if (result) {
              setNotice('Recovery key saved. Keep a separate copy in your password manager.')
            }
          } else {
            setStatus(result)
          }
        }
      } catch (failure) {
        if (mounted.current) {
          const message =
            failure instanceof Error ? failure.message : 'Backup action could not finish.'
          // Electron adds transport details that do not help someone fix their connection.
          setError(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
        }
      } finally {
        working.current = false
        if (mounted.current) {
          setBusy(false)
        }
      }
    },
    []
  )
  return {
    status,
    busy: busy || status?.health === 'connecting' || status?.health === 'running',
    error,
    notice,
    connect: (input: CloudBackupConnection) => perform(() => api!.connect(input)),
    runNow: () => perform(() => api!.runNow()),
    toggle: () => perform(() => api!.setEnabled(!status?.enabled)),
    exportKey: () => perform(() => api!.exportRecoveryKey())
  }
}
