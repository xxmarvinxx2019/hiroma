import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { Prisma } from '@prisma/client'
import { resolvePerformancePeriod } from '@/app/lib/performance-periods'

const PARTNER_TYPES = ['all', 'regional', 'provincial', 'city', 'branch', 'reseller'] as const
const RESULT_LIMITS = [5, 10, 20, 30] as const

type PartnerType = (typeof PARTNER_TYPES)[number]
type SpecificPartnerType = Exclude<PartnerType, 'all'>

interface DistributorPerformanceRow {
  id: string
  full_name: string
  username: string
  partner_type: Exclude<SpecificPartnerType, 'reseller'>
  region_name: string | null
  province_name: string | null
  city_muni_name: string | null
  product_revenue: number
  registration_revenue: number
  product_sales: number
  registration_sales: number
}

interface ResellerPerformanceRow {
  id: string
  full_name: string
  username: string
  direct_referral: number
  binary_commission: number
  product_binary: number
  other_income: number
  commission_count: number
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const requestedType = req.nextUrl.searchParams.get('type') || 'all'
    const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 10)
    const selectedPeriod = resolvePerformancePeriod(req.nextUrl.searchParams.get('period'))
    const type: PartnerType = PARTNER_TYPES.includes(requestedType as PartnerType)
      ? requestedType as PartnerType
      : 'all'
    const limit = RESULT_LIMITS.includes(requestedLimit as (typeof RESULT_LIMITS)[number])
      ? requestedLimit
      : 10
    const orderPeriodSql = selectedPeriod.start && selectedPeriod.end
      ? Prisma.sql`AND o.created_at >= ${selectedPeriod.start} AND o.created_at < ${selectedPeriod.end}`
      : Prisma.empty
    const registrationPeriodSql = selectedPeriod.start && selectedPeriod.end
      ? Prisma.sql`AND p.used_at >= ${selectedPeriod.start} AND p.used_at < ${selectedPeriod.end}`
      : Prisma.empty
    const registrationSnapshotPeriodSql = selectedPeriod.start && selectedPeriod.end
      ? Prisma.sql`AND rf.created_at >= ${selectedPeriod.start} AND rf.created_at < ${selectedPeriod.end}`
      : Prisma.empty
    const commissionPeriodSql = selectedPeriod.start && selectedPeriod.end
      ? Prisma.sql`AND c.created_at >= ${selectedPeriod.start} AND c.created_at < ${selectedPeriod.end}`
      : Prisma.empty

    const [distributorRows, resellerRows] = await Promise.all([
      prisma.$queryRaw<DistributorPerformanceRow[]>`
        SELECT
          u.id::text,
          u.full_name,
          u.username,
          CASE WHEN dp.dist_level = 'branch' THEN 'branch' ELSE u.role::text END AS partner_type,
          dp.region_name,
          dp.province_name,
          dp.city_muni_name,
          COALESCE(sales.product_revenue, 0)::float AS product_revenue,
          CASE
            WHEN dp.dist_level IN ('city', 'branch')
              THEN COALESCE(registrations.registration_revenue, 0)
            ELSE 0
          END::float AS registration_revenue,
          COALESCE(sales.product_sales, 0)::int AS product_sales,
          CASE
            WHEN dp.dist_level IN ('city', 'branch')
              THEN COALESCE(registrations.registration_sales, 0)
            ELSE 0
          END::int AS registration_sales
        FROM users u
        JOIN distributor_profiles dp ON dp.user_id = u.id
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(o.total_amount), 0) AS product_revenue,
            COUNT(o.id) AS product_sales
          FROM orders o
          WHERE o.seller_id = u.id AND o.status = 'delivered'
          ${orderPeriodSql}
        ) sales ON true
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(registration_profit), 0) AS registration_revenue,
            COUNT(*) AS registration_sales
          FROM (
            SELECT rf.registration_profit
            FROM registration_financials rf
            WHERE rf.city_dist_id = u.id
            ${registrationSnapshotPeriodSql}
            UNION ALL
            SELECT
              SUM(
                (
                  COALESCE(NULLIF(prod.reseller_price, 0), prod.price) -
                  CASE
                    WHEN dp.dist_level = 'branch'
                      THEN COALESCE(NULLIF(prod.branch_price, 0), prod.cost_price)
                    ELSE COALESCE(NULLIF(prod.city_price, 0), prod.cost_price)
                  END
                ) * pp.quantity
              ) AS registration_profit
            FROM pins p
            JOIN package_products pp ON pp.package_id = p.package_id
            JOIN products prod ON prod.id = pp.product_id
            WHERE p.city_dist_id = u.id
              AND p.status = 'used'
              AND NOT EXISTS (
                SELECT 1 FROM registration_financials rf WHERE rf.pin_id = p.id
              )
            ${registrationPeriodSql}
            GROUP BY p.id
          ) registration_values
        ) registrations ON true
        WHERE
          u.status = 'active'
          AND dp.dist_level IN ('regional', 'provincial', 'city', 'branch')
      `,
      prisma.$queryRaw<ResellerPerformanceRow[]>`
        SELECT
          u.id::text,
          u.full_name,
          u.username,
          COALESCE(SUM(c.amount) FILTER (WHERE c.type = 'direct_referral'), 0)::float AS direct_referral,
          COALESCE(SUM(c.amount) FILTER (WHERE c.type = 'binary_pairing'), 0)::float AS binary_commission,
          COALESCE(SUM(c.amount) FILTER (WHERE c.type = 'sponsor_point'), 0)::float AS product_binary,
          COALESCE(SUM(c.amount) FILTER (WHERE c.type = 'multilevel'), 0)::float AS other_income,
          COUNT(c.id)::int AS commission_count
        FROM users u
        JOIN commissions c ON c.user_id = u.id
        WHERE u.role = 'reseller' AND u.status = 'active'
        ${commissionPeriodSql}
        GROUP BY u.id, u.full_name, u.username
      `,
    ])

    const distributorPerformers = distributorRows.map((row) => {
      const productRevenue = Number(row.product_revenue || 0)
      const registrationRevenue = Number(row.registration_revenue || 0)
      const productSales = Number(row.product_sales || 0)
      const registrationSales = Number(row.registration_sales || 0)
      return {
        id: row.id,
        full_name: row.full_name,
        username: row.username,
        partner_type: row.partner_type,
        location: row.city_muni_name || row.province_name || row.region_name || 'Not specified',
        performance_value: productRevenue + registrationRevenue,
        activity_count: productSales + registrationSales,
        product_revenue: productRevenue,
        registration_revenue: registrationRevenue,
        product_sales: productSales,
        registration_sales: registrationSales,
        direct_referral: 0,
        binary_commission: 0,
        product_binary: 0,
        other_income: 0,
        metric_basis: row.partner_type === 'city' || row.partner_type === 'branch'
          ? 'Delivered sales + registration profit'
          : 'Delivered downstream product sales',
      }
    })

    const resellerPerformers = resellerRows.map((row) => {
      const directReferral = Number(row.direct_referral || 0)
      const binaryCommission = Number(row.binary_commission || 0)
      const productBinary = Number(row.product_binary || 0)
      const otherIncome = Number(row.other_income || 0)
      return {
        id: row.id,
        full_name: row.full_name,
        username: row.username,
        partner_type: 'reseller' as const,
        location: 'Network reseller',
        performance_value: directReferral + binaryCommission + productBinary + otherIncome,
        activity_count: Number(row.commission_count || 0),
        product_revenue: 0,
        registration_revenue: 0,
        product_sales: 0,
        registration_sales: 0,
        direct_referral: directReferral,
        binary_commission: binaryCommission,
        product_binary: productBinary,
        other_income: otherIncome,
        metric_basis: 'Credited commission income',
      }
    })

    const performers = [...distributorPerformers, ...resellerPerformers]
      .filter((row) => type === 'all' || row.partner_type === type)
      .filter((row) => row.performance_value > 0)
      .sort((a, b) =>
        b.performance_value - a.performance_value ||
        b.activity_count - a.activity_count ||
        a.full_name.localeCompare(b.full_name)
      )
      .slice(0, limit)
      .map((row, index) => ({ ...row, rank: index + 1 }))

    return NextResponse.json({
      performers,
      filters: {
        type,
        limit,
        period: selectedPeriod.period,
        period_label: selectedPeriod.label,
        start: selectedPeriod.start?.toISOString() || null,
        end: selectedPeriod.end?.toISOString() || null,
      },
      basis: {
        regional: 'Delivered sales made by the Regional Distributor',
        provincial: 'Delivered sales made by the Provincial Distributor',
        city: 'Delivered product sales plus registration profit',
        branch: 'Delivered product/walk-in sales plus registration profit',
        reseller: 'Direct referral, binary, product-binary, and other commission income',
      },
    })
  } catch (error) {
    console.error('[ADMIN TOP PERFORMERS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
