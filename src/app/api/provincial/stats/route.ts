import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'provincial') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now        = new Date()
    const today      = new Date(); today.setHours(0, 0, 0, 0)
    const yesterday  = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // ── Profile + supplier ──
    const profile = await prisma.distributorProfile.findUnique({
      where:  { user_id: user.id },
      select: {
        coverage_area: true,
        parent: { select: { user: { select: { full_name: true, username: true, role: true } }, dist_level: true } },
      },
    })

    const supplier = profile?.parent
      ? { full_name: profile.parent.user.full_name, username: profile.parent.user.username, level: 'Regional Distributor' }
      : null

    // ── City distributors under this provincial ──
    const cityDistProfiles = await prisma.distributorProfile.findMany({
      where:  { dist_level: 'city', parent: { user_id: user.id } },
      select: {
        user_id: true,
        user:    { select: { id: true, full_name: true, username: true } },
        city_muni_name: true,
      },
    })
    const cityDistIds    = cityDistProfiles.map(c => c.user_id)
    const cityDistCount  = cityDistProfiles.length

    const [
      totalOrders,
      pendingOrders,
      deliveredOrders,
      inventory,
      newCityDistsThisMonth,
    ] = await Promise.all([
      prisma.order.count({ where: { buyer_id: user.id } }),
      prisma.order.count({ where: { buyer_id: user.id, status: 'pending' } }),
      prisma.order.count({ where: { buyer_id: user.id, status: 'delivered' } }),
      prisma.inventory.findMany({
        where:  { owner_id: user.id },
        select: { quantity: true, low_stock_threshold: true, product: { select: { name: true } } },
      }),
      prisma.distributorProfile.count({
        where: { dist_level: 'city', parent: { user_id: user.id }, user: { created_at: { gte: monthStart } } },
      }),
    ])

    const lowStockItems   = inventory.filter(i => i.quantity <= i.low_stock_threshold && i.quantity > 0).length
    const outOfStockItems = inventory.filter(i => i.quantity === 0).length
    const totalStock      = inventory.reduce((s, i) => s + i.quantity, 0)

    // ── Today's sales (provincial sells to city dists) ──
    const todayItems = await prisma.orderItem.findMany({
      where:  { order: { seller_id: user.id, status: 'delivered', updated_at: { gte: today } } },
      select: { quantity: true, subtotal: true },
    })
    const yesterdayItems = await prisma.orderItem.findMany({
      where:  { order: { seller_id: user.id, status: 'delivered', updated_at: { gte: yesterday, lt: today } } },
      select: { quantity: true, subtotal: true },
    })
    const salesRevenueToday     = todayItems.reduce((s, i) => s + Number(i.subtotal || 0), 0)
    const salesRevenueYesterday = yesterdayItems.reduce((s, i) => s + Number(i.subtotal || 0), 0)
    const unitsSoldToday        = todayItems.reduce((s, i) => s + i.quantity, 0)

    // ── All-time sales ──
    const deliveredSales = await prisma.order.findMany({
      where:  { seller_id: user.id, status: 'delivered' },
      select: {
        items: {
          select: {
            quantity: true, subtotal: true,
            product: { select: { provincial_price: true, name: true } },
          },
        },
      },
    })
    const totalRevenue   = deliveredSales.reduce((s, o) => s + o.items.reduce((ss, i) => ss + Number(i.subtotal), 0), 0)
    const totalCost      = deliveredSales.reduce((s, o) => s + o.items.reduce((ss, i) => ss + Number(i.product.provincial_price || 0) * i.quantity, 0), 0)
    const totalProfit    = totalRevenue - totalCost
    const totalUnitsSold = deliveredSales.reduce((s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0)

    // ── Product movement ──
    const productMovement: Record<string, { name: string; qty: number; revenue: number }> = {}
    for (const order of deliveredSales) {
      for (const item of order.items) {
        const name = item.product.name
        if (!productMovement[name]) productMovement[name] = { name, qty: 0, revenue: 0 }
        productMovement[name].qty     += item.quantity
        productMovement[name].revenue += Number(item.subtotal)
      }
    }
    const topProducts = Object.values(productMovement).sort((a, b) => b.qty - a.qty).slice(0, 10)

    // ── Top performing city distributors ──
    const topCityDists: { id: string; full_name: string; username: string; city: string; revenue: number; resellers: number; orders: number }[] = []

    for (const city of cityDistProfiles) {
      const [cityOrders, cityResellers] = await Promise.all([
        prisma.order.aggregate({
          where: { seller_id: city.user_id, status: 'delivered' },
          _sum:  { total_amount: true },
          _count: { id: true },
        }),
        prisma.user.count({ where: { role: 'reseller', created_by: city.user_id } }),
      ])
      topCityDists.push({
        id:        city.user_id,
        full_name: city.user.full_name,
        username:  city.user.username,
        city:      city.city_muni_name || '—',
        revenue:   Number(cityOrders._sum.total_amount || 0),
        resellers: cityResellers,
        orders:    cityOrders._count.id,
      })
    }
    topCityDists.sort((a, b) => b.revenue - a.revenue)

    // ── Monthly revenue (last 6 months) ──
    const monthlyRevenue: { month: string; revenue: number; orders: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d     = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
      const mItems = await prisma.orderItem.findMany({
        where:  { order: { seller_id: user.id, status: 'delivered', updated_at: { gte: start, lte: end } } },
        select: { subtotal: true },
      })
      const mOrders = await prisma.order.count({
        where: { seller_id: user.id, status: 'delivered', updated_at: { gte: start, lte: end } },
      })
      monthlyRevenue.push({
        month:   d.toLocaleDateString('en-PH', { month: 'short' }),
        revenue: mItems.reduce((s, i) => s + Number(i.subtotal || 0), 0),
        orders:  mOrders,
      })
    }

    // ── Top resellers under city dists in this province ──
    const topResellers = await prisma.user.findMany({
      where:   { role: 'reseller', created_by: { in: cityDistIds } },
      select:  {
        id: true, full_name: true, username: true,
        wallet:           { select: { total_earned: true } },
        reseller_profile: { select: { package: { select: { name: true } } } },
      },
      orderBy: { wallet: { total_earned: 'desc' } },
      take:    5,
    })

    // ── Recent orders ──
    const recentOrders = await prisma.order.findMany({
      where:   { OR: [{ seller_id: user.id }, { buyer_id: user.id }] },
      orderBy: { created_at: 'desc' },
      take:    5,
      select:  {
        id: true, order_number: true, status: true,
        total_amount: true, created_at: true,
        buyer:  { select: { full_name: true, username: true } },
        seller: { select: { full_name: true } },
      },
    })

    return NextResponse.json({
      stats: {
        salesRevenueToday,
        salesRevenueYesterday,
        unitsSoldToday,
        cityDistCount,
        newCityDistsThisMonth,
        totalOrders,
        pendingOrders,
        deliveredOrders,
        lowStockItems,
        outOfStockItems,
        totalInventoryItems: inventory.length,
        totalStock,
        totalRevenue,
        totalCost,
        totalProfit,
        totalUnitsSold,
        topProducts,
        topCityDists:  topCityDists.slice(0, 5),
        topResellers:  topResellers.map(r => ({
          id:           r.id,
          full_name:    r.full_name,
          username:     r.username,
          total_earned: Number(r.wallet?.total_earned || 0),
          package_name: r.reseller_profile?.package?.name || '—',
        })),
        monthlyRevenue,
        recentOrders,
        inventoryItems: inventory.map(i => ({ name: (i.product as any).name, quantity: i.quantity, low: i.low_stock_threshold })),
      },
      coverage_area: profile?.coverage_area || '',
      supplier,
    })
  } catch (error) {
    console.error('[PROVINCIAL STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}