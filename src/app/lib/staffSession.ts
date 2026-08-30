export interface StaffSessionSnapshot {
  is_active: boolean
  user_status: string
  user_role: string
  user_login_disabled: boolean
  owner_id: string
  owner_role: string
  owner_status: string
  permissions: readonly string[]
}

export function isFreshStaffSessionAuthorized(
  tokenOwnerId: string | undefined,
  tokenRole: string,
  snapshot: StaffSessionSnapshot | null,
  requiredPermission: string | null,
): boolean {
  if (!tokenOwnerId || !snapshot) return false
  if (!snapshot.is_active || snapshot.user_status !== 'active' || snapshot.user_role !== 'staff' || snapshot.user_login_disabled || snapshot.owner_status !== 'active') return false
  if (snapshot.owner_id !== tokenOwnerId || snapshot.owner_role !== tokenRole) return false
  if (!requiredPermission) return true
  if (requiredPermission === '__owner_only__') return false
  return requiredPermission
    .split('|')
    .some((permission) => snapshot.permissions.includes(permission))
}
