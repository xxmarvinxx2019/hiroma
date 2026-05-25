import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// PATCH — upgrade reseller package
// City dist upgrades a reseller using a new PIN
// Only adds the DIFFERENCE in points to ancestors (guide rule #7)
// ============================================================

const POINTS_PER_PAIR      = 100
const DAILY_PAIRING_CAP    = 12
const BINARY_POINT_TO_PESO = 0.50

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { reseller_id, new_pin_id } = await req.json()

    if (!reseller_id || !new_pin_id) {
      return NextResponse.json({ error: 'reseller_id and new_pin_id are required.' }, { status: 400 })
    }

    // Get reseller's current profile
    const resellerProfile = await prisma.resellerProfile.findUnique({
      where:  { user_id: reseller_id },
      select: {
        user_id:    true,
        package_id: true,
        package: { select: { pairing_bonus_value: true, name: true } },
      },
    })

    if (!resellerProfile) {
      return NextResponse.json({ error: 'Reseller not found.' }, { status: 404 })
    }

    // Validate new PIN
    const pin = await prisma.pin.findUnique({
      where:  { id: new_pin_id },
      select: {
        id:          true,
        status:      true,
        city_dist_id: true,
        package_id:  true,
        package: { select: { pairing_bonus_value: true, name: true } },
      },
    })

    if (!pin || pin.status !== 'unused') {
      return NextResponse.json({ error: 'PIN is invalid or already used.' }, { status: 400 })
    }

    if (pin.city_dist_id !== user.id) {
      return NextResponse.json({ error: 'This PIN does not belong to your account.' }, { status: 400 })
    }

    const oldPts = Number(resellerProfile.package?.pairing_bonus_value || 0)
    const newPts = Number(pin.package?.pairing_bonus_value || 0)

    // Guide rule: can only upgrade to higher package
    if (newPts <= oldPts) {
      return NextResponse.json({
        error: `Cannot upgrade to ${pin.package?.name} — it must be a higher package than ${resellerProfile.package?.name}.`,
      }, { status: 400 })
    }

    // Difference in points — guide rule #7
    // Only add DIFFERENCE, not the full new package points
    const diffPts = newPts - oldPts

    console.log(`[UPGRADE] ${reseller_id} | ${resellerProfile.package?.name}(${oldPts}pts) → ${pin.package?.name}(${newPts}pts) | diff: +${diffPts}pts`)

    // Update reseller profile with new package + mark PIN as used
    await prisma.$transaction(async (tx) => {
      await tx.resellerProfile.update({
        where: { user_id: reseller_id },
        data:  { package_id: pin.package_id },
      })

      await tx.pin.update({
        where: { id: new_pin_id },
        data:  { status: 'used', used_by: reseller_id, used_at: new Date() },
      })
    })

    // Fire pairing bonus with DIFFERENCE points only
    const resellerNode = await prisma.binaryTreeNode.findUnique({
      where:  { user_id: reseller_id },
      select: { parent_id: true, position: true },
    })

    if (resellerNode?.parent_id && resellerNode.position && diffPts > 0) {
      await fireUpgradePairingBonus(
        reseller_id,
        diffPts,
        resellerNode.parent_id,
        resellerNode.position as 'left' | 'right'
      )
    }

    return NextResponse.json({
      success: true,
      message: `Reseller upgraded from ${resellerProfile.package?.name} to ${pin.package?.name}. +${diffPts} points added to upline.`,
    })
  } catch (error) {
    console.error('[UPGRADE ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── Same pairing logic but with diffPts only ──
async function fireUpgradePairingBonus(
  resellerId:   string,
  diffPts:      number,
  parentNodeId: string,
  newPosition:  'left' | 'right'
) {
  if (diffPts <= 0) return

  const ancestors = await prisma.$queryRaw<{
    id:        string
    user_id:   string
    parent_id: string | null
    position:  string | null
  }[]>`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, user_id, parent_id, position
      FROM binary_tree_nodes
      WHERE id = ${parentNodeId}

      UNION ALL

      SELECT n.id, n.user_id, n.parent_id, n.position
      FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, user_id, parent_id, position FROM ancestor_chain
  `

  if (!ancestors || ancestors.length === 0) return

  const hiromaUser = await prisma.user.findFirst({
    where:  { username: 'hiroma' },
    select: { id: true },
  })

  const ancestorUserIds = ancestors.map((a) => a.user_id)
  const profiles = await prisma.resellerProfile.findMany({
    where:  { user_id: { in: ancestorUserIds } },
    select: {
      user_id:             true,
      left_points:         true,
      right_points:        true,
      daily_pairing_count: true,
      daily_pairing_date:  true,
    },
  })
  const profileMap = new Map(profiles.map((p) => [p.user_id, p]))

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = 0; i < ancestors.length; i++) {
    const ancestor = ancestors[i]
    const leg: 'left' | 'right' = i === 0
      ? newPosition
      : ((ancestors[i - 1].position as 'left' | 'right') || 'left')

    const profile = profileMap.get(ancestor.user_id)
    if (!profile) {
      console.log(`[UPGRADE PAIRING] Skip ${ancestor.user_id} — no reseller profile`)
      continue
    }

    let leftPts  = Number(profile.left_points  || 0)
    let rightPts = Number(profile.right_points || 0)

    if (leg === 'left')  leftPts  += diffPts
    else                 rightPts += diffPts

    const pairPoints    = Math.min(leftPts, rightPts)
    const possiblePairs = Math.floor(pairPoints / POINTS_PER_PAIR)

    console.log(`[UPGRADE PAIRING] ${ancestor.user_id} | leg:${leg} | L:${leftPts} R:${rightPts} | pairs:${possiblePairs}`)

    if (possiblePairs > 0) {
      const lastPairDate = profile.daily_pairing_date
        ? new Date(profile.daily_pairing_date) : null
      const isToday   = lastPairDate ? lastPairDate >= today : false
      const usedToday = isToday ? Number(profile.daily_pairing_count || 0) : 0
      const remaining = Math.max(0, DAILY_PAIRING_CAP - usedToday)

      const paidPairs     = Math.min(possiblePairs, remaining)
      const overflowPairs = possiblePairs - paidPairs

      const paidEarnings     = paidPairs     * POINTS_PER_PAIR * BINARY_POINT_TO_PESO
      const overflowEarnings = overflowPairs * POINTS_PER_PAIR * BINARY_POINT_TO_PESO

      const deduct = possiblePairs * POINTS_PER_PAIR
      leftPts  -= deduct
      rightPts -= deduct

      if (paidPairs > 0 && paidEarnings > 0) {
        await prisma.commission.create({
          data: {
            user_id:          ancestor.user_id,
            type:             'binary_pairing',
            amount:           paidEarnings,
            points:           paidPairs * POINTS_PER_PAIR,
            source_user_id:   resellerId,
            is_pair_overflow: false,
          },
        })
        await prisma.wallet.update({
          where: { user_id: ancestor.user_id },
          data:  { balance: { increment: paidEarnings }, total_earned: { increment: paidEarnings } },
        })
      }

      if (overflowPairs > 0 && overflowEarnings > 0 && hiromaUser) {
        await prisma.commission.create({
          data: {
            user_id:          hiromaUser.id,
            type:             'binary_pairing',
            amount:           overflowEarnings,
            points:           overflowPairs * POINTS_PER_PAIR,
            source_user_id:   resellerId,
            overflow_to:      hiromaUser.id,
            is_pair_overflow: true,
          },
        })
        await prisma.wallet.upsert({
          where:  { user_id: hiromaUser.id },
          update: { balance: { increment: overflowEarnings }, total_earned: { increment: overflowEarnings } },
          create: { user_id: hiromaUser.id, balance: overflowEarnings, total_earned: overflowEarnings, total_withdrawn: 0 },
        })
      }

      // Log pairing event
      await prisma.$executeRawUnsafe(
        `INSERT INTO pairing_logs (id, member_id, left_points_used, right_points_used, pairs_created, commission, date_created)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
        ancestor.user_id,
        leg === 'left'  ? deduct : 0,
        leg === 'right' ? deduct : 0,
        paidPairs,
        paidEarnings
      )

      await prisma.resellerProfile.update({
        where: { user_id: ancestor.user_id },
        data: {
          left_points:         leftPts,
          right_points:        rightPts,
          daily_pairing_count: isToday ? { increment: paidPairs } : paidPairs,
          daily_pairing_date:  today,
        },
      })
    } else {
      await prisma.resellerProfile.update({
        where: { user_id: ancestor.user_id },
        data:  { left_points: leftPts, right_points: rightPts },
      })
    }
  }

  console.log('[UPGRADE PAIRING] Complete')
}