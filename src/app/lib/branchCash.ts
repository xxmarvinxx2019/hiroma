import { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export async function calculateCollectedCash(db: Db, branchId: string, start: Date, end: Date) {
  const date = { gte: start, lt: end }
  const [orders, registrations] = await Promise.all([
    db.order.findMany({ where: { seller_id: branchId, payment_status: 'paid', OR: [{ paid_at: date }, { paid_at: null, created_at: date }] }, select: { total_amount: true } }),
    db.registrationFinancial.findMany({ where: { city_dist_id: branchId, payment_status: 'paid', OR: [{ paid_at: date }, { paid_at: null, created_at: date }] }, select: { customer_payment: true } }),
  ])
  const productCash = orders.reduce((sum, row) => sum + Number(row.total_amount), 0)
  const registrationCash = registrations.reduce((sum, row) => sum + Number(row.customer_payment), 0)
  return { productCash, registrationCash, total: productCash + registrationCash }
}
