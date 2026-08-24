import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { resolvePerformancePeriod } from '@/app/lib/performance-periods'

export async function GET(req: NextRequest, context: RouteContext<'/api/city/top-performers/[id]'>) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await context.params
    const reseller = await prisma.resellerProfile.findFirst({
      where: { user_id: id, city_dist_id: user.id, user: { status: 'active' } },
      select: { user: { select: { full_name: true, username: true } }, package: { select: { name: true } } },
    })
    if (!reseller) return NextResponse.json({ error: 'Active reseller not found under your account.' }, { status: 404 })

    const period = resolvePerformancePeriod(
      req.nextUrl.searchParams.get('period'), new Date(),
      req.nextUrl.searchParams.get('from'), req.nextUrl.searchParams.get('to'),
    )
    const where = {
      user_id: id,
      ...(period.start && period.end ? { created_at: { gte: period.start, lt: period.end } } : {}),
    }
    const [rows, total] = await prisma.$transaction([
      prisma.commission.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: 50,
        select: {
          id: true, type: true, amount: true, points: true, created_at: true,
          source_user: { select: { full_name: true, username: true } },
        },
      }),
      prisma.commission.count({ where }),
    ])

    const labels = { direct_referral: 'Direct Referral', binary_pairing: 'Package Binary', sponsor_point: 'Product Binary', multilevel: 'Other Income' }
    return NextResponse.json({
      reseller: { ...reseller.user, package_name: reseller.package.name },
      entries: rows.map((row) => ({
        ...row,
        amount: Number(row.amount),
        type_label: labels[row.type],
        source_name: row.source_user?.full_name || null,
        source_username: row.source_user?.username || null,
      })),
      meta: { total, shown: rows.length, capped: total > rows.length },
      period: { label: period.label, start: period.start?.toISOString() || null, end: period.end?.toISOString() || null },
    })
  } catch (error) {
    console.error('[CITY TOP PERFORMER DETAILS ERROR]', error)
    return NextResponse.json({ error: 'Unable to load earnings details.' }, { status: 500 })
  }
}
