import type { UserRole } from '@/app/lib/auth'

export const LOGIN_PORTALS = ['member', 'distributor', 'admin'] as const
export type LoginPortal = (typeof LOGIN_PORTALS)[number]
export type LoginPortalContext = LoginPortal | 'legacy'

export function isLoginPortal(value: unknown): value is LoginPortal {
  return typeof value === 'string' && LOGIN_PORTALS.includes(value as LoginPortal)
}

export function isRoleAllowedInPortal(role: UserRole, portal: LoginPortalContext): boolean {
  if (portal === 'legacy') return true
  if (portal === 'member') return role === 'reseller'
  if (portal === 'admin') return role === 'admin'
  return role === 'regional' || role === 'provincial' || role === 'city'
}

export function portalAccessError(portal: LoginPortalContext): string {
  if (portal === 'member') return 'This portal is only for Hiroma member accounts.'
  if (portal === 'admin') return 'This portal is only for authorized admin accounts.'
  if (portal === 'distributor') return 'This portal is only for authorized distributor accounts.'
  return 'This account cannot use the selected login portal.'
}
