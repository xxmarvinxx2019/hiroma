export const ALLOWED_ORDER_PAYMENT_STATUSES = ['unpaid', 'paid'] as const

export function isAllowedOrderPaymentStatus(value: unknown) {
  return typeof value === 'string'
    && ALLOWED_ORDER_PAYMENT_STATUSES.includes(value as (typeof ALLOWED_ORDER_PAYMENT_STATUSES)[number])
}

export function canUpdateOrderPaymentStatus(
  actorId: string,
  order: { buyer_id: string; seller_id: string },
) {
  return order.seller_id === actorId
}
