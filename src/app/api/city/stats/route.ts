import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now       = new Date()
    const today     = new Date(); today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [
      totalResellers,
      activeResellers,
      newResellersToday,
      newResellersYesterday,
      newResellersThisMonth,
      unusedPins,
      usedPins,
      totalPinsRequested,
      totalOrders,
      pendingOrders,
      inventory,
      recentResellers,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'reseller', created_by: user.id } }),
      prisma.user.count({ where: { role: 'reseller', created_by: user.id, status: 'active' } }),
      prisma.user.count({ where: { role: 'reseller', created_by: user.id, created_at: { gte: today } } }),
      prisma.user.count({ where: { role: 'reseller', created_by: user.id, created_at: { gte: yesterday, lt: today } } }),
      prisma.user.count({ where: { role: 'reseller', created_by: user.id, created_at: { gte: monthStart } } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'unused' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'used'   } }),
      prisma.pin.count({ where: { city_dist_id: user.id } }),
      prisma.order.count({ where: { buyer_id: user.id } }),
      prisma.order.count({ where: { buyer_id: user.id, status: 'pending' } }),
      prisma.inventory.findMany({
        where:  { owner_id: user.id },
        select: { quantity: true, low_stock_threshold: true, product: { select: { name: true } } },
      }),
      prisma.user.findMany({
        where:   { role: 'reseller', created_by: user.id },
        orderBy: { created_at: 'desc' },
        take:    5,
        select:  {
          id: true, full_name: true, username: true, created_at: true,
          reseller_profile: { select: { package: { select: { name: true } } } },
        },
      }),
    ])

    const lowStockItems = inventory.filter(i => i.quantity <= i.low_stock_threshold).length
    const totalStock    = inventory.reduce((s, i) => s + i.quantity, 0)

    // ── Today's walk-in order sales ──
    const todayWalkInItems = await prisma.orderItem.findMany({
      where:  { order: { seller_id: user.id, status: 'delivered', updated_at: { gte: today } } },
      select: { quantity: true, subtotal: true },
    })
    const yesterdayWalkInItems = await prisma.orderItem.findMany({
      where:  { order: { seller_id: user.id, status: 'delivered', updated_at: { gte: yesterday, lt: today } } },
      select: { quantity: true, subtotal: true },
    })
    const salesRevenueToday     = todayWalkInItems.reduce((s, i) => s + Number(i.subtotal || 0), 0)
    const salesRevenueYesterday = yesterdayWalkInItems.reduce((s, i) => s + Number(i.subtotal || 0), 0)
    const unitsSoldToday        = todayWalkInItems.reduce((s, i) => s + i.quantity, 0)

    // ── Today's PINs used (reseller registrations today) ──
    const pinsUsedToday = await prisma.pin.count({
      where: { city_dist_id: user.id, status: 'used', used_at: { gte: today } },
    })

    // ── All-time product order sales ──
    const deliveredOrders = await prisma.order.findMany({
      where:  { seller_id: user.id, status: 'delivered' },
      select: {
        items: {
          select: {
            quantity: true, subtotal: true,
            product: { select: { city_price: true, name: true } },
          },
        },
      },
    })
    const orderRevenue   = deliveredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + Number(i.subtotal), 0), 0)
    const orderCost      = deliveredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + Number(i.product.city_price || 0) * i.quantity, 0), 0)
    const orderUnitsSold = deliveredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0)

    // ── Product movement (top products sold) ──
    const productMovement: Record<string, { name: string; qty: number; revenue: number }> = {}
    for (const order of deliveredOrders) {
      for (const item of order.items) {
        const name = item.product.name
        if (!productMovement[name]) productMovement[name] = { name, qty: 0, revenue: 0 }
        productMovement[name].qty     += item.quantity
        productMovement[name].revenue += Number(item.subtotal)
      }
    }
    const topProducts = Object.values(productMovement).sort((a, b) => b.qty - a.qty).slice(0, 10)

    // ── Package (PIN) sales from reseller registrations ──
    const usedPinPackages = await prisma.pin.findMany({
      where:  { city_dist_id: user.id, status: 'used' },
      select: {
        package: {
          select: {
            name: true, price: true,
            products: {
              select: {
                quantity: true,
                product: { select: { price: true, city_price: true } },
              },
            },
          },
        },
      },
    })

    // Package breakdown
    const packageBreakdown: Record<string, { name: string; count: number; revenue: number }> = {}
    let packageRevenue = 0, packageCost = 0, packageUnitsSold = 0
    for (const pin of usedPinPackages) {
      if (!pin.package) continue
      const pname = pin.package.name
      if (!packageBreakdown[pname]) packageBreakdown[pname] = { name: pname, count: 0, revenue: 0 }
      packageBreakdown[pname].count++
      packageBreakdown[pname].revenue += Number(pin.package.price || 0)
      for (const pp of pin.package.products) {
        packageRevenue   += Number(pp.product.price      || 0) * pp.quantity
        packageCost      += Number(pp.product.city_price || 0) * pp.quantity
        packageUnitsSold += pp.quantity
      }
    }

    // ── Monthly revenue (last 6 months) ──
    const monthlyRevenue: { month: string; revenue: number; resellers: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d     = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
      const label = d.toLocaleDateString('en-PH', { month: 'short' })

      const mItems = await prisma.orderItem.findMany({
        where:  { order: { seller_id: user.id, status: 'delivered', updated_at: { gte: start, lte: end } } },
        select: { subtotal: true },
      })
      const mResellers = await prisma.user.count({
        where: { role: 'reseller', created_by: user.id, created_at: { gte: start, lte: end } },
      })
      monthlyRevenue.push({
        month:     label,
        revenue:   mItems.reduce((s, i) => s + Number(i.subtotal || 0), 0),
        resellers: mResellers,
      })
    }

    // ── Recent orders (walk-in) ──
    const recentOrders = await prisma.order.findMany({
      where:   { seller_id: user.id },
      orderBy: { created_at: 'desc' },
      take:    5,
      select:  {
        id: true, order_number: true, status: true,
        total_amount: true, created_at: true,
        buyer: { select: { full_name: true, username: true } },
      },
    })

    const totalRevenue   = orderRevenue + packageRevenue
    const totalCost      = orderCost    + packageCost
    const totalProfit    = totalRevenue - totalCost
    const totalUnitsSold = orderUnitsSold + packageUnitsSold

    // ── Top earners among resellers ──
    const topEarners = await prisma.user.findMany({
      where:   { role: 'reseller', created_by: user.id },
      select:  {
        id: true, full_name: true, username: true,
        wallet:           { select: { total_earned: true, balance: true } },
        reseller_profile: { select: { package: { select: { name: true } } } },
      },
      orderBy: { wallet: { total_earned: 'desc' } },
      take:    5,
    })

    return NextResponse.json({
      stats: {
        // Today
        salesRevenueToday,
        salesRevenueYesterday,
        unitsSoldToday,
        newResellersToday,
        newResellersYesterday,
        newResellersThisMonth,
        pinsUsedToday,
        // Totals
        totalResellers,
        activeResellers,
        unusedPins,
        usedPins,
        totalPinsRequested,
        totalOrders,
        pendingOrders,
        lowStockItems,
        totalInventoryItems: inventory.length,
        totalStock,
        // Revenue
        totalRevenue,
        totalCost,
        totalProfit,
        totalUnitsSold,
        orderRevenue,
        orderCost,
        orderUnitsSold,
        packageRevenue,
        packageCost,
        packageUnitsSold,
        // Lists
        topProducts,
        packageBreakdown: Object.values(packageBreakdown).sort((a, b) => b.count - a.count),
        monthlyRevenue,
        recentResellers,
        recentOrders,
        topEarners: topEarners.map(r => ({
          id: r.id,
          full_name: r.full_name,
          username: r.username,
          total_earned: Number(r.wallet?.total_earned || 0),
          balance: Number(r.wallet?.balance || 0),
          package_name: r.reseller_profile?.package?.name || '—',
        })),
        inventoryItems: inventory.map(i => ({ name: (i.product as any).name, quantity: i.quantity, low: i.low_stock_threshold })),
      },
    })
  } catch (error) {
    console.error('[CITY STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}