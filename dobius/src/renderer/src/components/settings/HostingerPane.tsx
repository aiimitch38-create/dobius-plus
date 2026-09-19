import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  HostingerDnsRecord,
  HostingerDnsType,
  HostingerDomain,
  HostingerStatus,
  HostingerVps
} from '../../../../shared/hostinger'
import {
  HOSTINGER_DEFAULT_TTL,
  HOSTINGER_DNS_TYPES,
  isHostingerDnsType
} from '../../../../shared/hostinger'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow, SettingsSubsectionHeader } from './SettingsFormControls'
import { getHostingerPaneSearchEntries } from './hostinger-search'
import { translate } from '@/i18n/i18n'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function HostingerPane(): React.JSX.Element {
  const tokenInputRef = useRef<HTMLInputElement | null>(null)
  const [hasToken, setHasToken] = useState(false)
  const [status, setStatus] = useState<HostingerStatus | null>(null)
  const [vps, setVps] = useState<HostingerVps[]>([])
  const [domains, setDomains] = useState<HostingerDomain[]>([])
  const [selectedDomain, setSelectedDomain] = useState<string>('')
  const [records, setRecords] = useState<HostingerDnsRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [dnsName, setDnsName] = useState('@')
  const [dnsType, setDnsType] = useState<HostingerDnsType>('A')
  const [dnsContent, setDnsContent] = useState('')
  const [dnsTtl, setDnsTtl] = useState(String(HOSTINGER_DEFAULT_TTL))
  const [dnsReplace, setDnsReplace] = useState(false)

  const loadAccount = useCallback(async () => {
    setBusy(true)
    try {
      const nextStatus = await window.api.hostinger.status()
      setStatus(nextStatus)
      setHasToken(nextStatus.hasToken)
      if (!nextStatus.ok) {
        setVps([])
        setDomains([])
        return
      }
      const [nextVps, nextDomains] = await Promise.all([
        window.api.hostinger.listVps(),
        window.api.hostinger.listDomains()
      ])
      setVps(nextVps)
      setDomains(nextDomains)
      setSelectedDomain((current) => current || nextDomains.find((d) => d.status === 'active')?.domain || '')
    } catch (error) {
      // status() never throws, but the two list calls can (network drop, 5xx after a good status)
      setVps([])
      setDomains([])
      toast.error(errorMessage(error, translate('auto.components.settings.HostingerPane.loadFailed', 'Could not load Hostinger account.')))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void loadAccount()
  }, [loadAccount])

  useEffect(() => {
    if (!selectedDomain) {
      setRecords([])
      return
    }
    let cancelled = false
    void window.api.hostinger
      .listDns(selectedDomain)
      .then((next) => {
        if (!cancelled) setRecords(next)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRecords([])
          toast.error(errorMessage(error, translate('auto.components.settings.HostingerPane.dnsLoadFailed', 'Could not load DNS records.')))
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedDomain])

  const setToken = useCallback(async () => {
    const token = tokenInputRef.current?.value.trim() ?? ''
    if (!token) {
      setFeedback(translate('auto.components.settings.HostingerPane.tokenRequired', 'Enter an API token before setting it.'))
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      await window.api.hostinger.setToken(token)
      if (tokenInputRef.current) tokenInputRef.current.value = ''
      const msg = translate('auto.components.settings.HostingerPane.tokenSet', 'Hostinger token saved.')
      setFeedback(msg)
      toast.success(msg)
    } catch (error) {
      const msg = errorMessage(error, translate('auto.components.settings.HostingerPane.tokenFailed', 'Could not save token.'))
      setFeedback(msg)
      toast.error(msg)
      setBusy(false)
      return
    }
    setBusy(false)
    // Outside the token try/catch: a failed account load must not read as "could not save token".
    await loadAccount()
  }, [loadAccount])

  const clearToken = useCallback(async () => {
    setBusy(true)
    setFeedback(null)
    try {
      await window.api.hostinger.clearToken()
      if (tokenInputRef.current) tokenInputRef.current.value = ''
      setHasToken(false)
      setStatus(null)
      setVps([])
      setDomains([])
      setSelectedDomain('')
      const msg = translate('auto.components.settings.HostingerPane.tokenCleared', 'Token cleared.')
      setFeedback(msg)
      toast.success(msg)
    } catch (error) {
      const msg = errorMessage(error, translate('auto.components.settings.HostingerPane.tokenClearFailed', 'Could not clear token.'))
      setFeedback(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }, [])

  const addRecord = useCallback(async () => {
    if (!selectedDomain) return
    const ttl = Number.parseInt(dnsTtl, 10)
    setBusy(true)
    try {
      const next = await window.api.hostinger.upsertDns({
        domain: selectedDomain,
        name: dnsName.trim() || '@',
        type: dnsType,
        content: dnsContent.trim(),
        ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : undefined,
        replace: dnsReplace
      })
      setRecords(next)
      setDnsContent('')
      setDnsReplace(false)
      toast.success(translate('auto.components.settings.HostingerPane.dnsSaved', 'DNS record saved.'))
    } catch (error) {
      toast.error(errorMessage(error, translate('auto.components.settings.HostingerPane.dnsSaveFailed', 'Could not save DNS record.')))
    } finally {
      setBusy(false)
    }
  }, [selectedDomain, dnsName, dnsType, dnsContent, dnsTtl, dnsReplace])

  // What "replace" would delete, so the user sees it before clicking Save.
  const existingForTarget = records.find((r) => r.name === (dnsName.trim() || '@') && r.type === dnsType)?.values ?? []

  const searchEntry = getHostingerPaneSearchEntries()[0]
  const connectionText = feedback
    ?? (status?.ok
      ? translate('auto.components.settings.HostingerPane.statusConnected', '● Connected')
      : status?.error
        ? status.error
        : hasToken
          ? translate('auto.components.settings.HostingerPane.statusChecking', 'Checking…')
          : translate('auto.components.settings.HostingerPane.statusNotConnected', 'Not connected'))

  return (
    <div className="space-y-4">
      <SearchableSetting
        title={searchEntry.title}
        description={searchEntry.description}
        keywords={searchEntry.keywords}
        className="space-y-1 py-2"
        id="hostinger-account"
      >
        <SettingsRow
          label={translate('auto.components.settings.HostingerPane.tokenLabel', 'Hostinger API token')}
          description={connectionText}
          alignTop
          control={
            <div className="flex flex-wrap justify-end gap-2">
              <Input
                ref={tokenInputRef}
                type="password"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                placeholder={translate('auto.components.settings.HostingerPane.tokenPlaceholder', 'New token')}
                disabled={busy}
                className="h-7 w-56 font-mono text-xs"
              />
              <Button type="button" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void setToken()}>
                {translate('auto.components.settings.HostingerPane.setTokenButton', 'Set')}
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !hasToken} onClick={() => void clearToken()}>
                {translate('auto.components.settings.HostingerPane.clearTokenButton', 'Clear')}
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !hasToken} onClick={() => void loadAccount()}>
                {translate('auto.components.settings.HostingerPane.refreshButton', 'Refresh')}
              </Button>
            </div>
          }
        />

        {status?.ok ? (
          <>
            <SettingsSubsectionHeader
              title={translate('auto.components.settings.HostingerPane.vpsHeader', 'Servers')}
              description={translate('auto.components.settings.HostingerPane.vpsDescription', 'VPS instances on this account.')}
            />
            {vps.length === 0 ? (
              <p className="text-xs text-muted-foreground">{translate('auto.components.settings.HostingerPane.vpsNone', 'No VPS on this account.')}</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-normal">{translate('auto.components.settings.HostingerPane.colHostname', 'Hostname')}</th>
                    <th className="py-1 text-left font-normal">{translate('auto.components.settings.HostingerPane.colPlan', 'Plan')}</th>
                    <th className="py-1 text-left font-normal">{translate('auto.components.settings.HostingerPane.colIpv4', 'IPv4')}</th>
                    <th className="py-1 text-left font-normal">{translate('auto.components.settings.HostingerPane.colOs', 'OS')}</th>
                    <th className="py-1 text-left font-normal">{translate('auto.components.settings.HostingerPane.colState', 'State')}</th>
                  </tr>
                </thead>
                <tbody>
                  {vps.map((v) => (
                    <tr key={v.id} className="border-t border-border/50">
                      <td className="py-1 font-mono">{v.hostname}</td>
                      <td className="py-1">{v.plan}</td>
                      <td className="py-1 font-mono">{v.ipv4 ?? '—'}</td>
                      <td className="py-1">{v.template ?? '—'}</td>
                      <td className="py-1">{v.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <SettingsSubsectionHeader
              title={translate('auto.components.settings.HostingerPane.domainsHeader', 'Domains')}
              description={translate('auto.components.settings.HostingerPane.domainsDescription', 'Pick a domain to view and add DNS records.')}
            />
            <SettingsRow
              label={translate('auto.components.settings.HostingerPane.domainLabel', 'Domain')}
              control={
                <Select value={selectedDomain} onValueChange={setSelectedDomain} disabled={busy || domains.length === 0}>
                  <SelectTrigger className="h-7 w-64 text-xs">
                    <SelectValue placeholder={translate('auto.components.settings.HostingerPane.domainPlaceholder', 'Choose a domain')} />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((d) => (
                      <SelectItem key={`${d.domain}-${d.type}`} value={d.domain}>
                        {d.domain} · {d.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            {selectedDomain ? (
              <>
                {records.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{translate('auto.components.settings.HostingerPane.dnsNone', 'No records.')}</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-normal">{translate('auto.components.settings.HostingerPane.colName', 'Name')}</th>
                        <th className="py-1 text-left font-normal">{translate('auto.components.settings.HostingerPane.colType', 'Type')}</th>
                        <th className="py-1 text-left font-normal">{translate('auto.components.settings.HostingerPane.colValue', 'Value')}</th>
                        <th className="py-1 text-left font-normal">{translate('auto.components.settings.HostingerPane.colTtl', 'TTL')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={`${r.name}-${r.type}`} className="border-t border-border/50 align-top">
                          <td className="py-1 font-mono">{r.name}</td>
                          <td className="py-1">{r.type}</td>
                          <td className="py-1 font-mono break-all">{r.values.join(', ')}</td>
                          <td className="py-1">{r.ttl}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <SettingsRow
                  label={translate('auto.components.settings.HostingerPane.addRecordLabel', 'Add a record')}
                  description={
                    dnsReplace && existingForTarget.length > 0
                      ? translate(
                          'auto.components.settings.HostingerPane.replaceWarning',
                          'Replace is on: this will delete {{values}}.'
                        ).replace('{{values}}', existingForTarget.join(', '))
                      : translate(
                          'auto.components.settings.HostingerPane.addRecordDescription',
                          'Existing values for the same name and type are kept unless Replace is on.'
                        )
                  }
                  alignTop
                  control={
                    <div className="flex flex-wrap justify-end gap-2">
                      <Input value={dnsName} onChange={(e) => setDnsName(e.target.value)} placeholder="@" disabled={busy} className="h-7 w-24 font-mono text-xs" />
                      <Select value={dnsType} onValueChange={(v) => { if (isHostingerDnsType(v)) setDnsType(v) }} disabled={busy}>
                        <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {HOSTINGER_DNS_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={dnsContent}
                        onChange={(e) => setDnsContent(e.target.value)}
                        placeholder={
                          dnsType === 'CNAME'
                            ? translate('auto.components.settings.HostingerPane.placeholderCname', 'target.example.com')
                            : dnsType === 'TXT'
                              ? translate('auto.components.settings.HostingerPane.placeholderTxt', 'text')
                              : translate('auto.components.settings.HostingerPane.placeholderIp', '1.2.3.4')
                        }
                        disabled={busy}
                        className="h-7 w-48 font-mono text-xs"
                      />
                      <Input value={dnsTtl} onChange={(e) => setDnsTtl(e.target.value)} placeholder={String(HOSTINGER_DEFAULT_TTL)} disabled={busy} className="h-7 w-20 font-mono text-xs" />
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input type="checkbox" checked={dnsReplace} onChange={(e) => setDnsReplace(e.target.checked)} disabled={busy} />
                        {translate('auto.components.settings.HostingerPane.replaceToggle', 'Replace')}
                      </label>
                      <Button type="button" size="sm" className="h-7 text-xs" disabled={busy || !dnsContent.trim()} onClick={() => void addRecord()}>
                        {translate('auto.components.settings.HostingerPane.addRecordButton', 'Save record')}
                      </Button>
                    </div>
                  }
                />
              </>
            ) : null}
          </>
        ) : null}
      </SearchableSetting>
    </div>
  )
}
