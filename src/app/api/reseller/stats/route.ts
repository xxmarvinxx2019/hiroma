import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { getRanksForPackage, getActivePeriod } from '@/app/api/admin/ranks/route'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const results = await Promise.all([


      // Reseller profile + package + city dist
      prisma.resellerProfile.findUnique({
        where: { user_id: user.id },
        select: {
          total_points:         true,
          daily_referral_count: true,
          last_referral_date:   true,
          points_reset_at:      true,
          package_id:           true,
          package: {
            select: { name: true, price: true, direct_referral_bonus: true, pairing_bonus_value: true, point_php_value: true },
          },
          city_dist: {
            select: { full_name: true, username: true },
          },
        },
      }),

      // Wallet balance
      prisma.wallet.findUnique({
        where: { user_id: user.id },
        select: { balance: true, total_earned: true, total_withdrawn: true },
      }),

      // Binary tree node — left/right counts
      prisma.binaryTreeNode.findUnique({
        where: { user_id: user.id },
        select: {
          left_count:  true,
          right_count: true,
          position:    true,
          sponsor: { select: { full_name: true, username: true } },
        },
      }),

      // Commission totals grouped by type
      prisma.commission.groupBy({
        by: ['type'],
        where: { user_id: user.id },
        _sum:   { amount: true },
        _count: { type: true },
      }),

      // Recent 5 commissions
      prisma.commission.findMany({
        where:   { user_id: user.id },
        orderBy: { created_at: 'desc' },
        take: 5,
        select: {
          type:       true,
          amount:     true,
          points:     true,
          created_at: true,
          source_user: { select: { full_name: true, username: true } },
        },
      }),
    ])

    const profileBase       = results[0] as any
    let rankData = { rank: 'default', total_pu: 0 }
    let referralCap = { enabled: true, cap: 10 }
    let rankOptions: Awaited<ReturnType<typeof getRanksForPackage>> = []
    let activePeriod: Awaited<ReturnType<typeof getActivePeriod>> = null

    if (profileBase?.package_id) {
      const [rankRows, capRows, resolvedRanks, resolvedPeriod] = await Promise.all([
        prisma.$queryRaw<{ rank: string; total_pu: number }[]>`
          SELECT COALESCE(rank, 'default') as rank, COALESCE(total_pu, 0) as total_pu
          FROM reseller_profiles WHERE user_id::text = ${user.id}
        `.catch(() => []),
        prisma.$queryRaw<{ enabled: boolean; cap: number }[]>`
        SELECT COALESCE(direct_referral_cap_enabled, true) AS enabled,
               COALESCE(daily_referral_cap, 10)::int AS cap
        FROM packages
        WHERE id = ${profileBase.package_id}
        `,
        getRanksForPackage(profileBase.package_id),
        getActivePeriod(profileBase.package_id),
      ])

      if (rankRows[0]) {
        rankData = { rank: rankRows[0].rank, total_pu: Number(rankRows[0].total_pu) }
      }
      if (capRows[0]) {
        referralCap = { enabled: Boolean(capRows[0].enabled), cap: Number(capRows[0].cap) || 10 }
      }
      rankOptions = resolvedRanks
      activePeriod = resolvedPeriod
    }
    const profile = profileBase ? { ...profileBase, ...rankData } : null
    const wallet            = results[1] as any
    const treeNode          = results[2] as any
    const commissions       = (results[3] || []) as any[]
    const recentCommissions = (results[4] || []) as any[]

    // Shape commission summary
    const commissionSummary = {
      direct_referral: { amount: 0, count: 0 },
      binary_pairing:  { amount: 0, count: 0 },
      multilevel:      { amount: 0, count: 0 },
      sponsor_point:   { amount: 0, count: 0 },
    }
    for (const row of commissions) {
      commissionSummary[row.type as keyof typeof commissionSummary] = {
        amount: Number(row._sum.amount || 0),
        count:  row._count.type,
      }
    }

    // Daily referral cap check
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const lastDate = profile?.last_referral_date
    const isToday  = lastDate ? new Date(lastDate) >= today : false
    const dailyReferralsToday = isToday ? (profile?.daily_referral_count || 0) : 0
    const dailyReferralsLeft = referralCap.enabled
      ? Math.max(0, referralCap.cap - dailyReferralsToday)
      : 0

    return NextResponse.json({
      user: {
        full_name: user.full_name,
        username:  user.username,
      },
      package:  profile?.package  || null,
      city_dist: profile?.city_dist || null,
      wallet: {
        balance:         Number(wallet?.balance        || 0),
        total_earned:    Number(wallet?.total_earned   || 0),
        total_withdrawn: Number(wallet?.total_withdrawn || 0),
      },
      tree: {
        left_count:  treeNode?.left_count  || 0,
        right_count: treeNode?.right_count || 0,
        position:    treeNode?.position    || null,
        sponsor:     treeNode?.sponsor     || null,
      },
      points: {
        total:       profile?.total_points || 0,
        reset_at:    profile?.points_reset_at || null,
        php_value:   Number(profile?.package?.point_php_value || 0),
      },
      referrals: {
        today:      dailyReferralsToday,
        remaining:  dailyReferralsLeft,
        cap:        referralCap.cap,
        cap_enabled: referralCap.enabled,
      },
      rank: {
        current:       profile?.rank       || 'default',
        total_pu:      profile?.total_pu   || 0,
        ranks:         rankOptions,
        active_period: activePeriod,
      },
      commission_summary: commissionSummary,
      recent_commissions: recentCommissions,
    })
  } catch (error) {
    console.error('[RESELLER STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
