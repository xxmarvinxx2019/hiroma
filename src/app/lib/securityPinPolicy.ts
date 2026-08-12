import type { UserRole } from '@/app/lib/auth'

export const SECURITY_PIN_OWNER_ROLES: readonly UserRole[] = ['reseller', 'regional', 'provincial', 'city', 'admin']

export function isSecurityPinEligibleRole(role: string): role is UserRole {
  return SECURITY_PIN_OWNER_ROLES.includes(role as UserRole)
}