import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export async function calculateShiftCashSales(db: Db, shiftId: string) {
  const [productSales, registrationSales] = await Promise.all([
    db.posTransaction.aggregate({
      where: {
        shift_id: shiftId,
        payment_method_snapshot: 'cash',
        status: { in: ['approved', 'finalized'] },
      },
      _sum: { total_snapshot: true },
    }),
    db.posRegistrationIntake.aggregate({
      where: {
        shift_id: shiftId,
        payment_method_id: null,
        status: {
          in: [
            'released_pending_encoding',
            'encoding_in_progress',
            'registration_completed',
          ],
        },
      },
      _sum: { amount_snapshot: true },
    }),
  ])

  const productCash = Number(productSales._sum.total_snapshot || 0)
  const registrationCash = Number(registrationSales._sum.amount_snapshot || 0)
  return { productCash, registrationCash, total: productCash + registrationCash }
}
