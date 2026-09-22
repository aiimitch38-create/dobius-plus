const FALLBACK_DOBIUS_DEV_ENVIRONMENT_URL = 'http://localhost:5173/'

type DevEnvironmentLocation = {
  host: string
  protocol: string
}

export function resolveDobiusDevEnvironmentUrl(
  location: DevEnvironmentLocation = window.location
): string {
  const protocol = location.protocol.toLowerCase()
  const host = location.host.trim()

  if ((protocol === 'http:' || protocol === 'https:') && host) {
    return `${protocol}//${host}/`
  }

  return FALLBACK_DOBIUS_DEV_ENVIRONMENT_URL
}
