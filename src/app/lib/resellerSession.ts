export interface ResellerSessionClaims {
  role?: string
  session_epoch?: number
}

export function isResellerSessionCurrent(
  claims: ResellerSessionClaims,
  passwordChangedAt: Date | null,
): boolean {
  if (claims.role !== 'reseller' || !passwordChangedAt) return true
  return claims.session_epoch === passwordChangedAt.getTime()
}
