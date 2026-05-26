import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [
      totalResellers, activeResellers,
      unusedPins, usedPins,
      totalOrders, pendingOrders,
      inventory,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'reseller', created_by: user.id } }),
      prisma.user.count({ where: { role: 'reseller', created_by: user.id, status: 'active' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'unused' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'used'   } }),
      prisma.order.count({ where: { buyer_id: user.id } }),
      prisma.order.count({ where: { buyer_id: user.id, status: 'pending' } }),
      prisma.inventory.findMany({
        where:  { owner_id: user.id },
        select: { quantity: true, low_stock_threshold: true },
      }),
    ])

    const lowStockItems = inventory.filter(
      (i) => i.quantity <= i.low_stock_threshold
    ).length

    // ── Product order sales (city sells to resellers via walk-in orders) ──
    const deliveredOrders = await prisma.order.findMany({
      where:  { seller_id: user.id, status: 'delivered' },
      select: {
        items: {
          select: {
            quantity:   true,
            subtotal:   true,
            product: { select: { city_price: true } },
          },
        },
      },
    })

    const orderRevenue   = deliveredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + Number(i.subtotal), 0), 0)
    const orderCost      = deliveredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + Number(i.product.city_price || 0) * i.quantity, 0), 0)
    const orderUnitsSold = deliveredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0)

    // ── Package (PIN) sales from reseller registrations ──
    // Revenue = SRP value of products in each used PIN package
    const usedPinPackages = await prisma.pin.findMany({
      where:  { city_dist_id: user.id, status: 'used' },
      select: {
        package: {
          select: {
            price: true,  // PIN price
            products: {
              select: {
                quantity: true,
                product:  { select: { price: true, city_price: true } }, // price = SRP
              },
            },
          },
        },
      },
    })

    let packageRevenue   = 0
    let packageCost      = 0
    let packageUnitsSold = 0

    for (const pin of usedPinPackages) {
      if (!pin.package) continue
      for (const pp of pin.package.products) {
        const srp       = Number(pp.product.price      || 0)
        const cityPrice = Number(pp.product.city_price || 0)
        packageRevenue   += srp       * pp.quantity
        packageCost      += cityPrice * pp.quantity
        packageUnitsSold += pp.quantity
      }
    }

    // ── Combined totals ──
    const totalRevenue   = orderRevenue   + packageRevenue
    const totalCost      = orderCost      + packageCost
    const totalProfit    = totalRevenue   - totalCost
    const totalUnitsSold = orderUnitsSold + packageUnitsSold

    return NextResponse.json({
      stats: {
        totalResellers,
        activeResellers,
        unusedPins,
        usedPins,
        totalOrders,
        pendingOrders,
        lowStockItems,
        totalInventoryItems: inventory.length,
        // Combined sales
        totalRevenue,
        totalCost,
        totalProfit,
        totalUnitsSold,
        // Breakdown
        orderRevenue,
        orderCost,
        packageRevenue,
        packageCost,
        packageUnitsSold,
      },
    })
  } catch (error) {
    console.error('[CITY STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}