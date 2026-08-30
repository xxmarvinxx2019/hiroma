import { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export function isCashPaymentMethod(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase().replaceAll(' ', '_')
  return normalized === 'cash' || normalized === 'cash_on_pickup'
}

export async function calculateCollectedCash(db: Db, branchId: string, start: Date, end: Date) {
  const date = { gte: start, lt: end }
  const [orders, registrations] = await Promise.all([
    db.order.findMany({
      where: {
        seller_id: branchId,
        payment_status: 'paid',
        OR: [{ paid_at: date }, { paid_at: null, created_at: date }],
      },
      select: { total_amount: true, payment_method: true },
    }),
    db.posRegistrationIntake.findMany({
      where: {
        owner_id: branchId,
        payment_method_id: null,
        status: {
          in: [
            'released_pending_encoding',
            'encoding_in_progress',
            'registration_completed',
          ],
        },
        local_created_at: date,
      },
      select: { amount_snapshot: true, payment_method_snapshot: true },
    }),
  ])
  const productCash = orders.reduce(
    (sum, row) => sum + (isCashPaymentMethod(row.payment_method) ? Number(row.total_amount) : 0),
    0,
  )
  const registrationCash = registrations.reduce(
    (sum, row) => sum + (isCashPaymentMethod(row.payment_method_snapshot) ? Number(row.amount_snapshot) : 0),
    0,
  )
  return { productCash, registrationCash, total: productCash + registrationCash }
}
