import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { resolvePerformancePeriod } from '@/app/lib/performance-periods'

const RESULT_LIMITS = [5, 10, 20, 30] as const

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 10)
    const selectedPeriod = resolvePerformancePeriod(req.nextUrl.searchParams.get('period'))
    const limit = RESULT_LIMITS.includes(requestedLimit as (typeof RESULT_LIMITS)[number])
      ? requestedLimit
      : 10

    const resellerProfiles = await prisma.resellerProfile.findMany({
      where: { city_dist_id: user.id, user: { status: 'active' } },
      select: {
        user_id: true,
        user: { select: { full_name: true, username: true } },
        package: { select: { name: true } },
      },
    })
    const resellerIds = resellerProfiles.map((profile) => profile.user_id)

    const commissionRows = resellerIds.length > 0
      ? await prisma.commission.groupBy({
          by: ['user_id', 'type'],
          where: {
            user_id: { in: resellerIds },
            ...(selectedPeriod.start && selectedPeriod.end
              ? { created_at: { gte: selectedPeriod.start, lt: selectedPeriod.end } }
              : {}),
          },
          _sum: { amount: true },
          _count: { id: true },
        })
      : []

    const incomeByReseller = new Map<string, {
      direct_referral: number
      binary_commission: number
      product_binary: number
      other_income: number
      commission_count: number
    }>()

    for (const row of commissionRows) {
      const income = incomeByReseller.get(row.user_id) || {
        direct_referral: 0,
        binary_commission: 0,
        product_binary: 0,
        other_income: 0,
        commission_count: 0,
      }
      const amount = Number(row._sum.amount || 0)
      if (row.type === 'direct_referral') income.direct_referral += amount
      else if (row.type === 'binary_pairing') income.binary_commission += amount
      else if (row.type === 'sponsor_point') income.product_binary += amount
      else income.other_income += amount
      income.commission_count += row._count.id
      incomeByReseller.set(row.user_id, income)
    }

    const performers = resellerProfiles
      .map((profile) => {
        const income = incomeByReseller.get(profile.user_id) || {
          direct_referral: 0,
          binary_commission: 0,
          product_binary: 0,
          other_income: 0,
          commission_count: 0,
        }
        return {
          id: profile.user_id,
          full_name: profile.user.full_name,
          username: profile.user.username,
          package_name: profile.package.name,
          ...income,
          total_income:
            income.direct_referral +
            income.binary_commission +
            income.product_binary +
            income.other_income,
        }
      })
      .filter((performer) => performer.total_income > 0)
      .sort((a, b) =>
        b.total_income - a.total_income ||
        b.commission_count - a.commission_count ||
        a.full_name.localeCompare(b.full_name)
      )
      .slice(0, limit)
      .map((performer, index) => ({ ...performer, rank: index + 1 }))

    const account = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true, coverage_area: true },
    })

    return NextResponse.json({
      performers,
      filters: {
        limit,
        period: selectedPeriod.period,
        period_label: selectedPeriod.label,
        start: selectedPeriod.start?.toISOString() || null,
        end: selectedPeriod.end?.toISOString() || null,
      },
      account_type: account?.dist_level || 'city',
      coverage_area: account?.coverage_area || '',
      basis: 'Current location assignment through reseller_profiles.city_dist_id',
    })
  } catch (error) {
    console.error('[CITY TOP PERFORMERS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
