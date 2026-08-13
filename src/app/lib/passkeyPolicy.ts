export type PasskeyEligibleAccount = {
  role: string
  status: string
  login_disabled: boolean
}

export function isPasskeyEligible(account: PasskeyEligibleAccount | null | undefined): boolean {
  return Boolean(account && ['reseller', 'regional', 'provincial', 'city', 'admin'].includes(account.role) && account.status === 'active' && !account.login_disabled)
}

export function normalizeDeviceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ')
  return name.length >= 2 && name.length <= 60 ? name : null
}
