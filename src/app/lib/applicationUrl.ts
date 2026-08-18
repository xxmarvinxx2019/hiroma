const DNS_HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

export class ApplicationUrlConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApplicationUrlConfigurationError'
  }
}

function parseExactApplicationOrigin(value: string, production: boolean): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ApplicationUrlConfigurationError('APP_URL is invalid.')
  }

  if (url.origin !== value || url.username || url.password) {
    throw new ApplicationUrlConfigurationError('APP_URL must be an exact origin without credentials, path, query, or fragment.')
  }
  if (production && url.protocol !== 'https:') {
    throw new ApplicationUrlConfigurationError('APP_URL must use HTTPS in production.')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost' && !production)) {
    throw new ApplicationUrlConfigurationError('APP_URL must use HTTPS.')
  }
  if (url.hostname !== 'localhost' && !DNS_HOSTNAME.test(url.hostname)) {
    throw new ApplicationUrlConfigurationError('APP_URL hostname is invalid.')
  }
  return url.origin
}

export function resolveApplicationUrl(input: {
  configuredUrl?: string
  requestOrigin: string
  production?: boolean
}): string {
  const production = input.production ?? false
  const configuredUrl = input.configuredUrl?.trim()
  if (production && !configuredUrl) {
    throw new ApplicationUrlConfigurationError('APP_URL is required in production.')
  }
  return parseExactApplicationOrigin(configuredUrl || input.requestOrigin, production)
}
