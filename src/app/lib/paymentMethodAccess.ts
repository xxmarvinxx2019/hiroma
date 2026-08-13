export function canReadPaymentMethodTarget(viewerId: string, viewerRole: string, targetId: string, authorizedSupplierId: string | null): boolean {
  if (viewerRole === 'admin') return true
  if (targetId === viewerId) return true
  return Boolean(authorizedSupplierId && targetId === authorizedSupplierId)
}
