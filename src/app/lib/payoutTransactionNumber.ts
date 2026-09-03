export function generatePayoutTransactionNumber(payoutId: string, requestedAt: Date): string {
  return `PAY-${requestedAt.getUTCFullYear()}-${payoutId}`
}
