import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Recent PIN sales ──
    const recentSales = await prisma.order.findMany({
      where: { notes: { contains: 'PIN sale' } },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: {
        id: true,
        total_amount: true,
        created_at: true,
        notes: true,
        buyer: {
          select: { full_name: true, username: true },
        },
      },
    })

    // ── By city distributor — group by city_dist_id, count only ──
    const byDistributorRaw = await prisma.pin.groupBy({
      by: ['city_dist_id'],
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
            notes: { contains: 'PIN sale' },
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

    // ── By package — group by package_id, count only ──
    const byPackageRaw = await prisma.pin.groupBy({
      by: ['package_id'],
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

    return NextResponse.json({
      recentSales,
      byDistributor,
      byPackage,
    })
  } catch (error) {
    console.error('[PIN SALES ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}