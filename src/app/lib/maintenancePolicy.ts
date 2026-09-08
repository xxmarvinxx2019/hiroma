export type MaintenanceDecision = 'allow' | 'block-api' | 'redirect'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const RECOVERY_PATHS = new Set([
  '/maintenance',
  '/login/admin',
  '/api/auth/login',
  // The endpoint independently verifies the short-lived, signed challenge
  // and allows completion only for the Admin owner while maintenance is on.
  '/api/auth/login/pin',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/admin/maintenance',
])

export function canCompleteMaintenanceSecurityPin(input: {
  active: boolean
  challengeRole: string
}): boolean {
  return !input.active || input.challengeRole === 'admin'
}

export function decideMaintenanceAccess(input: {
  pathname: string
  method: string
  active: boolean
  isOwnerAdmin: boolean
}): MaintenanceDecision {
  if (!input.active || RECOVERY_PATHS.has(input.pathname)) return 'allow'

  if (input.pathname.startsWith('/api/')) {
    return input.isOwnerAdmin && SAFE_METHODS.has(input.method) ? 'allow' : 'block-api'
  }

  return input.isOwnerAdmin && SAFE_METHODS.has(input.method) && input.pathname.startsWith('/dashboard/admin')
    ? 'allow'
    : 'redirect'
}
