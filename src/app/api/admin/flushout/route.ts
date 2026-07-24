import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const DAILY_PAIR_CAP = 10

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const page      = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize  = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))
    const pkgFilter = searchParams.get('package') || 'all'
    const search    = searchParams.get('search')  || ''
    const dateFrom  = searchParams.get('from')    || ''
    const dateTo    = searchParams.get('to')      || ''

    const today    = new Date(); today.setHours(0, 0, 0, 0)
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
    // Default: all history if no date provided
    const fromDate = dateFrom ? new Date(dateFrom)              : new Date('2020-01-01')
    const toDate   = dateTo   ? new Date(dateTo + 'T23:59:59') : todayEnd

    // ── Packages for config table ──
    const packages = await prisma.package.findMany({
      where:   { is_active: true },
      select:  { id: true, name: true, pairing_bonus_value: true },
      orderBy: { price: 'asc' },
    })
    const pkgNames = packages.map(p => p.name)

    // ── Base where for overflow commissions ──
    const where: any = {
      is_pair_overflow: true,
      created_at:       { gte: fromDate, lte: toDate },
    }

    // Search by source_user name/username
    if (search) {
      where.source_user = {
        OR: [
          { full_name: { contains: search, mode: 'insensitive' } },
          { username:  { contains: search, mode: 'insensitive' } },
        ],
      }
    }

    const [total, records] = await Promise.all([
      prisma.commission.count({ where }),
      prisma.commission.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select:  {
          id: true, amount: true, points: true, created_at: true, type: true, overflow_to: true,
          source_user_id: true,
          // source_user = the reseller who triggered the overflow
          source_user: { select: { id: true, full_name: true, username: true, status: true } },
          // user = Hiroma (receives overflow value)
          user: { select: { id: true, full_name: true, username: true } },
        },
      }),
    ])

    // ── Fetch reseller profiles for source_user IDs to get package info ──
    const sourceIds = records.map(r => r.source_user_id).filter(Boolean) as string[]
    const profiles  = sourceIds.length > 0
      ? await prisma.resellerProfile.findMany({
          where:  { user_id: { in: sourceIds } },
          select: {
            user_id: true,
            package: { select: { name: true, pairing_bonus_value: true } },
          },
        })
      : []
    const profileMap = new Map(profiles.map(p => [p.user_id, p]))

    // ── Filter by package ──
    const formattedRecords = records
      .map(r => {
        const profile  = r.source_user_id ? profileMap.get(r.source_user_id) : null
        const pkgName  = profile?.package?.name || '—'
        const pairVal  = Number(profile?.package?.pairing_bonus_value || 0)
        const pts      = Number(r.points || 0)
        const amt      = Number(r.amount || 0)

        // Check if source_user is deactivated
        const sourceProfile = r.source_user_id ? profileMap.get(r.source_user_id) : null

        // Determine reason based on actual context
        let reason = 'Flushout to Hiroma'
        if (r.type === 'direct_referral') {
          reason = 'Direct referral package difference'
        } else if (pts === 0) {
          reason = 'Deactivated account — wallet balance flushed'
        } else if (r.source_user?.status === 'inactive') {
          reason = `Deactivated account — binary pairing flushed`
        } else {
          reason = 'Binary pair cap exceeded (daily limit)'
        }

        return {
          id:             r.id,
          date:           r.created_at,
          member:         r.source_user?.full_name || '—',
          username:       r.source_user?.username  || '—',
          member_id:      `MEM-${String(r.source_user_id || r.user.id).slice(0, 6).toUpperCase()}`,
          package:        pkgName,
          exceeded_pairs: pts,
          pair_value:     pairVal,
          flushout_value: amt,
          remarks:        reason,
        }
      })
      .filter(r => pkgFilter === 'all' || r.package === pkgFilter)

    // ── Summary using raw SQL to avoid any Prisma field mapping issues ──
    const summaryRaw = await prisma.$queryRaw<{ total_count: number; total_value: number; source_ids: string[] }[]>`
      SELECT
        COUNT(*)::int            AS total_count,
        COALESCE(SUM(amount), 0)::float AS total_value,
        ARRAY_AGG(DISTINCT source_user_id) AS source_ids
      FROM commissions
      WHERE is_pair_overflow = true
        AND created_at >= ${fromDate}
        AND created_at <= ${toDate}
    `
    const summaryRow      = summaryRaw[0] || { total_count: 0, total_value: 0, source_ids: [] }
    const totalPairsToday = Number(summaryRow.total_count  || 0)
    const totalValueToday = Number(summaryRow.total_value  || 0)
    const affectedIds     = (summaryRow.source_ids || []).filter(Boolean)
    const affectedMembers = affectedIds.length
    const avgFlushout     = affectedMembers > 0 ? (totalPairsToday / affectedMembers) : 0

    // Still need todayOverflow for package breakdown
    const todayOverflow = await prisma.commission.findMany({
      where:  { is_pair_overflow: true, created_at: { gte: fromDate, lte: toDate } },
      select: { amount: true, points: true, source_user_id: true },
    })

    // ── Package breakdown (today) ──
    const colors = ['#6366f1', '#22c55e', '#8b5cf6', '#f59e0b', '#e05252']
    const packageBreakdown: Record<string, { pairs: number; value: number; color: string }> = {}
    packages.forEach((pkg, i) => {
      packageBreakdown[pkg.name] = { pairs: 0, value: 0, color: colors[i] || '#9ca3af' }
    })

    const todaySourceIds = [...new Set(todayOverflow.map(r => r.source_user_id).filter(Boolean))] as string[]
    const todayProfiles  = todaySourceIds.length > 0
      ? await prisma.resellerProfile.findMany({
          where:  { user_id: { in: todaySourceIds } },
          select: { user_id: true, package: { select: { name: true } } },
        })
      : []
    const todayPkgMap = new Map(todayProfiles.map(p => [p.user_id, p.package?.name || 'Unknown']))

    for (const r of todayOverflow) {
      const pkgName = r.source_user_id ? (todayPkgMap.get(r.source_user_id) || 'Unknown') : 'Unknown'
      if (!packageBreakdown[pkgName]) packageBreakdown[pkgName] = { pairs: 0, value: 0, color: '#9ca3af' }
      packageBreakdown[pkgName].pairs += Number(r.points || 0)
      packageBreakdown[pkgName].value += Number(r.amount || 0)
    }

    return NextResponse.json({
      records: formattedRecords,
      summary: {
        total_pairs_today: totalPairsToday,
        total_value_today: totalValueToday,
        affected_members:  affectedMembers,
        avg_flushout:      Math.round(avgFlushout * 100) / 100,
        total_records:     total,
      },
      package_breakdown: packageBreakdown,
      package_config: packages.map((pkg, i) => ({
        name:             pkg.name,
        daily_pair_limit: DAILY_PAIR_CAP,
        pair_value:       Number(pkg.pairing_bonus_value),
        limit_type:       'Per Day',
        color:            colors[i] || '#9ca3af',
      })),
      package_names: pkgNames,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[FLUSHOUT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}