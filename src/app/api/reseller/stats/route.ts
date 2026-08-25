import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { getRanksForPackage } from '@/app/api/admin/ranks/route'
import prisma from '@/app/lib/prisma'
import { ensureCurrentProductBinaryQuarter, getManilaQuarter } from '@/app/lib/productBinaryQuarter'
import { calculateProductBinaryBalance } from '@/app/lib/productBinaryBalance'
import { getDailyInspiration, getManilaDate } from '@/app/lib/dailyInspiration'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    await prisma.$transaction(tx => ensureCurrentProductBinaryQuarter(tx, user.id))

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
          id:          true,
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

    if (profileBase?.package_id) {
      const [rankRows, capRows, resolvedRanks] = await Promise.all([
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
      ])

      if (rankRows[0]) {
        rankData = { rank: rankRows[0].rank, total_pu: Number(rankRows[0].total_pu) }
      }
      if (capRows[0]) {
        referralCap = { enabled: Boolean(capRows[0].enabled), cap: Number(capRows[0].cap) || 10 }
      }
      rankOptions = resolvedRanks
    }
    const profile = profileBase ? { ...profileBase, ...rankData } : null
    const wallet            = results[1] as any
    const treeNode          = results[2] as any
    const commissions       = (results[3] || []) as any[]
    const recentCommissions = (results[4] || []) as any[]
    const productBinaryRows = await prisma.$queryRaw<{
      left_carryover_pu: number
      right_carryover_pu: number
      lifetime_pairs: number
    }[]>`
      SELECT COALESCE(left_carryover_pu, 0)::int AS left_carryover_pu,
             COALESCE(right_carryover_pu, 0)::int AS right_carryover_pu,
             COALESCE(lifetime_pairs, 0)::int AS lifetime_pairs
      FROM product_binary_positions
      WHERE user_id = ${user.id}
      LIMIT 1
    `.catch(() => [])
    const productBinaryRow = productBinaryRows[0]
    const inspirationSettings = await prisma.systemSetting.findMany({
      where: { key: { in: [`daily_inspiration:${user.id}:enabled`, `daily_inspiration:${user.id}:hidden_on`] } },
      select: { key: true, value: true },
    })
    const inspirationSettingMap = new Map(inspirationSettings.map((setting) => [setting.key, setting.value]))
    const productLegTotalsRows = treeNode?.id
      ? await prisma.$queryRaw<{ left_total_pu: number; right_total_pu: number }[]>`
          WITH RECURSIVE product_legs AS (
            SELECT child.id, child.user_id, child.position::text AS source_leg
            FROM binary_tree_nodes child
            WHERE child.parent_id = ${treeNode.id}
            UNION ALL
            SELECT child.id, child.user_id, product_legs.source_leg
            FROM binary_tree_nodes child
            JOIN product_legs ON child.parent_id = product_legs.id
          )
          SELECT
            COALESCE(SUM(event.total_pu) FILTER (WHERE product_legs.source_leg = 'left'), 0)::int AS left_total_pu,
            COALESCE(SUM(event.total_pu) FILTER (WHERE product_legs.source_leg = 'right'), 0)::int AS right_total_pu
          FROM product_legs
          JOIN product_binary_order_events event ON event.buyer_user_id = product_legs.user_id
        `.catch(() => [])
      : []
    const productLegTotals = productLegTotalsRows[0]
    const productBinaryBalance = calculateProductBinaryBalance(
      Number(productBinaryRow?.left_carryover_pu || 0),
      Number(productBinaryRow?.right_carryover_pu || 0),
    )

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
        quarter:       getManilaQuarter(),
      },
      product_binary: {
        ...productBinaryBalance,
        left_total_pu:    Number(productLegTotals?.left_total_pu || 0),
        right_total_pu:   Number(productLegTotals?.right_total_pu || 0),
        pu_per_leg:       2,
        lifetime_pairs:   Number(productBinaryRow?.lifetime_pairs || 0),
      },
      daily_inspiration: {
        enabled: inspirationSettingMap.get(`daily_inspiration:${user.id}:enabled`) !== 'false',
        hidden_today: inspirationSettingMap.get(`daily_inspiration:${user.id}:hidden_on`) === getManilaDate(),
        quote: getDailyInspiration(),
      },
      commission_summary: commissionSummary,
      recent_commissions: recentCommissions,
    })
  } catch (error) {
    console.error('[RESELLER STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
