export type PasskeyConfigInput = {
  requestOrigin: string
  configuredOrigin?: string
  configuredRPID?: string
  configuredRPName?: string
  production?: boolean
}

const DNS_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

function parseOrigin(value: string, production: boolean): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Passkey origin is invalid.')
  }

  if (url.origin !== value || url.username || url.password || (production && url.protocol !== 'https:')) {
    throw new Error('Passkey origin must be an exact HTTPS origin in production.')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost' && !production)) {
    throw new Error('Passkey origin must use HTTPS.')
  }
  if (url.hostname !== 'localhost' && !DNS_HOSTNAME.test(url.hostname)) {
    throw new Error('Passkey origin hostname is invalid.')
  }
  return url
}

function normalizeRPID(value: string): string {
  const rpID = value.trim().toLowerCase().replace(/\.$/, '')
  if (!rpID || rpID.includes('://') || rpID.includes('/') || rpID.includes(':')) {
    throw new Error('Passkey RP ID must be a hostname.')
  }
  if (rpID !== 'localhost' && !DNS_HOSTNAME.test(rpID)) {
    throw new Error('Passkey RP ID is invalid.')
  }
  return rpID
}

export function resolvePasskeyConfig(input: PasskeyConfigInput) {
  const production = input.production ?? false
  const hasConfiguredOrigin = Boolean(input.configuredOrigin)
  const hasConfiguredRPID = Boolean(input.configuredRPID)

  if (hasConfiguredOrigin !== hasConfiguredRPID) {
    throw new Error('PASSKEY_ORIGIN and PASSKEY_RP_ID must be configured together.')
  }

  const originURL = parseOrigin(
    hasConfiguredOrigin ? input.configuredOrigin! : input.requestOrigin,
    production,
  )
  const rpID = normalizeRPID(hasConfiguredRPID ? input.configuredRPID! : originURL.hostname)
  const originHostname = originURL.hostname.toLowerCase()

  if (originHostname !== rpID && !originHostname.endsWith(`.${rpID}`)) {
    throw new Error('Passkey RP ID must match the origin hostname or its parent domain.')
  }

  return {
    origin: originURL.origin,
    rpID,
    rpName: input.configuredRPName?.trim() || 'Hiroma',
  }
}