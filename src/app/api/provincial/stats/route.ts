import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'provincial') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get profile + parent chain
    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: {
        coverage_area: true,
        parent: {
          select: {
            user: { select: { full_name: true, username: true, role: true } },
            dist_level: true,
          },
        },
      },
    })

    const [
      cityDistributors,
      totalOrders,
      pendingOrders,
      deliveredOrders,
      inventory,
    ] = await Promise.all([
      // City dists under this provincial
      prisma.distributorProfile.count({
        where: { dist_level: 'city', parent: { user_id: user.id } },
      }),

      prisma.order.count({ where: { buyer_id: user.id } }),
      prisma.order.count({ where: { buyer_id: user.id, status: 'pending' } }),
      prisma.order.count({ where: { buyer_id: user.id, status: 'delivered' } }),

      prisma.inventory.findMany({
        where: { owner_id: user.id },
        select: { quantity: true, low_stock_threshold: true },
      }),
    ])

    const lowStockItems  = inventory.filter((i) => i.quantity <= i.low_stock_threshold && i.quantity > 0).length
    const outOfStockItems = inventory.filter((i) => i.quantity === 0).length
    const totalUnits      = inventory.reduce((s, i) => s + i.quantity, 0)

    // Resolve supplier
    const supplier = profile?.parent
      ? { full_name: profile.parent.user.full_name, username: profile.parent.user.username, level: 'Regional Distributor' }
      : null

    return NextResponse.json({
      stats: {
        cityDistributors,
        totalOrders,
        pendingOrders,
        deliveredOrders,
        lowStockItems,
        outOfStockItems,
        totalInventoryItems: inventory.length,
        totalUnits,
      },
      coverage_area: profile?.coverage_area || '',
      supplier,
    })
  } catch (error) {
    console.error('[PROVINCIAL STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}