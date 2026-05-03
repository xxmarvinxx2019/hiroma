import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
      totalResellers,
      totalDistributors,
      pendingPayouts,
      pendingPayoutsAmount,
      pinsSoldToday,
      newResellersToday,
      totalProducts,
      activePins,
      totalPinRevenue,
      totalPinsSold,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'reseller' } }),
      prisma.user.count({
        where: { role: { in: ['regional', 'provincial', 'city'] } },
      }),
      prisma.payout.count({ where: { status: 'pending' } }),
      prisma.payout.aggregate({
        where: { status: 'pending' },
        _sum: { amount: true },
      }),
      prisma.pin.count({
        where: { status: 'used', used_at: { gte: today } },
      }),
      prisma.user.count({
        where: { role: 'reseller', created_at: { gte: today } },
      }),
      prisma.product.count({ where: { is_active: true } }),
      prisma.pin.count({ where: { status: 'unused' } }),
      // Total PIN revenue from orders
      prisma.order.aggregate({
        where: { notes: { contains: 'PIN sale' } },
        _sum: { total_amount: true },
      }),
      // Total PINs ever generated
      prisma.pin.count(),
    ])

    // PIN revenue today
    const pinRevenueToday = await prisma.order.aggregate({
      where: {
        notes: { contains: 'PIN sale' },
        created_at: { gte: today },
      },
      _sum: { total_amount: true },
    })

    return NextResponse.json({
      stats: {
        totalResellers,
        totalDistributors,
        pendingPayouts,
        pendingPayoutsAmount: Number(pendingPayoutsAmount._sum.amount || 0),
        pinsSoldToday,
        newResellersToday,
        totalProducts,
        activePins,
        totalPinRevenue: Number(totalPinRevenue._sum.total_amount || 0),
        totalPinRevenueToday: Number(pinRevenueToday._sum.total_amount || 0),
        totalPinsSold,
      },
    })
  } catch (error) {
    console.error('[ADMIN STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}