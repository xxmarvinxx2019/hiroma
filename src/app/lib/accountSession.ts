export interface AccountSessionClaims {
  session_epoch?: number
}

export function isAccountSessionCurrent(claims: AccountSessionClaims, passwordChangedAt: Date | null): boolean {
  if (!passwordChangedAt) return true
  return claims.session_epoch === passwordChangedAt.getTime()
}
