import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getDashboardPeriod } from '@/app/lib/dashboardPeriod'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let period
    try {
      period = getDashboardPeriod(req.nextUrl.searchParams)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid dashboard period.' },
        { status: 400 },
      )
    }

    // Sale reporting is driven by explicit paid PIN-sale receipts. PIN usage
    // is a later redemption event and must not move or fabricate sale revenue.
    const paidSaleWhere = {
      financial_purpose: 'pin_sale',
      payment_status: 'paid',
      status: 'delivered' as const,
      paid_at: { gte: period.start, lt: period.end },
    }
    const recentSales = await prisma.order.findMany({
      where: paidSaleWhere,
      orderBy: { paid_at: 'desc' },
      take: 20,
      select: {
        id: true, order_number: true,
        total_amount: true,
        created_at: true, paid_at: true,
        payment_method: true, payment_reference: true, payment_sender_name: true,
        notes: true,
        _count: { select: { funded_pins: true } },
        buyer: {
          select: { full_name: true, username: true },
        },
      },
    })

    const issuedSalePinsWhere = {
      funding_order: paidSaleWhere,
    }
    const byDistributorRaw = await prisma.pin.groupBy({
      by: ['city_dist_id'],
      where: issuedSalePinsWhere,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    })

    // ── Enrich with user info + revenue per distributor ──
    const byDistributor = await Promise.all(
      byDistributorRaw.map(async (d) => {
        const dist = await prisma.user.findUnique({
          where: { id: d.city_dist_id },
          select: { full_name: true, username: true },
        })
        const revenue = await prisma.order.aggregate({
          where: {
            buyer_id: d.city_dist_id,
            ...paidSaleWhere,
          },
          _sum: { total_amount: true },
        })
        return {
          city_dist_id: d.city_dist_id,
          _count: { id: d._count.id },
          _sum: { price: Number(revenue._sum.total_amount || 0) },
          city_distributor: dist,
        }
      })
    )

    const byPackageRaw = await prisma.pin.groupBy({
      by: ['package_id'],
      where: issuedSalePinsWhere,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    })

    // ── Enrich with package info ──
    const byPackage = await Promise.all(
      byPackageRaw.map(async (p) => {
        const pkg = await prisma.package.findUnique({
          where: { id: p.package_id },
          select: { name: true, price: true },
        })
        return {
          package_id: p.package_id,
          _count: { id: p._count.id },
          package: pkg,
        }
      })
    )

    const internalTransferWhere = {
      admin_id: user.id,
      dispatched_at: { gte: period.start, lt: period.end },
    }
    const [internalTransfers, internalTransferTotals] = await Promise.all([
      prisma.pinTransfer.findMany({
        where: internalTransferWhere,
        orderBy: { dispatched_at: 'desc' },
        take: 20,
        select: {
          id: true, reference_number: true, recipient_id: true, quantity: true,
          reference_value: true, sale_value: true, status: true, dispatched_at: true, received_at: true,
        },
      }),
      prisma.pinTransfer.aggregate({
        where: internalTransferWhere,
        _count: { id: true },
        _sum: { quantity: true, reference_value: true, sale_value: true },
      }),
    ])
    const saleTotals = await prisma.order.aggregate({
      where: paidSaleWhere,
      _sum: { total_amount: true },
      _count: { id: true },
    })

    return NextResponse.json({
      recentSales,
      byDistributor,
      byPackage,
      internalTransfers: internalTransfers.map((transfer) => ({
        ...transfer,
        reference_value: Number(transfer.reference_value),
        sale_value: Number(transfer.sale_value),
      })),
      totals: {
        paid_sale_count: saleTotals._count.id,
        paid_sale_revenue: Number(saleTotals._sum.total_amount || 0),
        internal_transfer_count: internalTransferTotals._count.id,
        internal_transfer_pin_count: internalTransferTotals._sum.quantity || 0,
        internal_transfer_reference_value: Number(internalTransferTotals._sum.reference_value || 0),
        internal_transfer_revenue: Number(internalTransferTotals._sum.sale_value || 0),
      },
    })
  } catch (error) {
    console.error('[PIN SALES ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
