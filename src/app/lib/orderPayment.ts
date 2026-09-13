export const ORDER_PAYMENT_WINDOW_HOURS = 48
export const ORDER_PAYMENT_WINDOW_MS = ORDER_PAYMENT_WINDOW_HOURS * 60 * 60 * 1000

export function orderPaymentDeadline(createdAt = new Date(), pickupAt?: Date | null) {
  const standardDeadline = new Date(createdAt.getTime() + ORDER_PAYMENT_WINDOW_MS)
  return pickupAt && pickupAt < standardDeadline ? pickupAt : standardDeadline
}

export function isElectronicOrderPayment(method: string | null | undefined) {
  return method === 'gcash' || method === 'bank_transfer'
}
