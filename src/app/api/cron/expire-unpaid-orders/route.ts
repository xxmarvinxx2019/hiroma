import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { releaseOrderStock } from '@/app/lib/inventoryReservation'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BATCH_SIZE = 100
const WORK_BUDGET_MS = 50_000

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const startedAt = Date.now()
  const failedIds: string[] = []
  let checked = 0
  let cancelled = 0
  let budgetReached = false

  while (!budgetReached) {
    const expired = await prisma.order.findMany({
      where: {
        status: 'pending',
        payment_status: { in: ['awaiting_payment', 'payment_rejected'] },
        payment_due_at: { lte: new Date() },
        ...(failedIds.length ? { id: { notIn: failedIds } } : {}),
      },
      orderBy: [{ payment_due_at: 'asc' }, { id: 'asc' }],
      select: { id: true, seller_id: true, buyer_id: true, order_number: true, items: { select: { product_id: true, quantity: true } } },
      take: BATCH_SIZE,
    })
    if (expired.length === 0) break

    for (const order of expired) {
      if (Date.now() - startedAt >= WORK_BUDGET_MS) {
        budgetReached = true
        break
      }
      checked += 1
      try {
        const didCancel = await prisma.$transaction(async (tx) => {
          const claimed = await tx.order.updateMany({ where: { id: order.id, status: 'pending', payment_status: { in: ['awaiting_payment', 'payment_rejected'] }, payment_due_at: { lte: new Date() } }, data: { status: 'cancelled', payment_status: 'expired', cancelled_at: new Date(), cancelled_by_name: 'Hiroma System', cancelled_by_role: 'system', cancellation_reason: 'Automatically cancelled because the electronic payment deadline expired.' } })
          if (claimed.count !== 1) return false
          await releaseOrderStock(tx, order.seller_id, order.items)
          await tx.notification.createMany({ data: [order.buyer_id, order.seller_id].map((user_id) => ({ user_id, type: 'order_payment_expired', title: 'Unpaid order automatically cancelled', message: `${order.order_number || 'An order'} passed its payment deadline. Reserved stock was released.`, entity_type: 'order', entity_id: order.id, action_url: user_id === order.buyer_id ? '/dashboard/reseller/orders' : '/dashboard/city/orders' })) })
          return true
        })
        if (didCancel) cancelled += 1
      } catch (error) {
        failedIds.push(order.id)
        console.error('[EXPIRE UNPAID ORDER]', order.id, error)
      }
    }
    if (expired.length < BATCH_SIZE) break
  }

  const remaining = await prisma.order.count({
    where: { status: 'pending', payment_status: { in: ['awaiting_payment', 'payment_rejected'] }, payment_due_at: { lte: new Date() } },
  })
  return NextResponse.json({ checked, cancelled, failed: failedIds.length, remaining, budget_reached: budgetReached })
}
