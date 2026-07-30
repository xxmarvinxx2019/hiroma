import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { Prisma } from '@prisma/client'

// ============================================================
// PATCH — upgrade reseller package
// City dist upgrades a reseller using a new PIN
// Only adds the DIFFERENCE in points to ancestors (guide rule #7)
// ============================================================

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
        user_id: true, package_id: true, city_dist_id: true,
        package: { select: { pairing_bonus_value: true, direct_referral_bonus: true, name: true, products: { select: { product_id: true, quantity: true } } } },
      },
    })

    if (!resellerProfile) return NextResponse.json({ error: 'Reseller not found.' }, { status: 404 })
    if (resellerProfile.city_dist_id !== user.id) return NextResponse.json({ error: 'This reseller is not registered under your City Distributor account.' }, { status: 403 })

    // Validate new PIN
    const pin = await prisma.pin.findUnique({
      where:  { id: new_pin_id },
      select: {
        id: true, status: true, city_dist_id: true, package_id: true, pin_type: true, upgrade_from_package_id: true,
        pin_allocation_snapshot: true, upgrade_customer_payment_snapshot: true, upgrade_reseller_value_snapshot: true,
        upgrade_acquisition_cost_snapshot: true, upgrade_direct_allocation_snapshot: true, upgrade_binary_allocation_snapshot: true, upgrade_points_difference_snapshot: true,
        package: { select: { pairing_bonus_value: true, direct_referral_bonus: true, name: true, products: { select: { product_id: true, quantity: true } } } },
      },
    })

    if (!pin || pin.status !== 'unused') {
      return NextResponse.json({ error: 'PIN is invalid or already used.' }, { status: 400 })
    }

    if (pin.city_dist_id !== user.id) {
      return NextResponse.json({ error: 'This PIN does not belong to your account.' }, { status: 400 })
    }

    if (pin.pin_type !== 'upgrade') return NextResponse.json({ error: 'A dedicated Upgrade PIN is required.' }, { status: 400 })
    if (pin.upgrade_from_package_id !== resellerProfile.package_id) return NextResponse.json({ error: 'This Upgrade PIN does not match the current package.' }, { status: 400 })
    if (pin.upgrade_customer_payment_snapshot == null || pin.upgrade_reseller_value_snapshot == null || pin.upgrade_acquisition_cost_snapshot == null || pin.upgrade_binary_allocation_snapshot == null || pin.upgrade_points_difference_snapshot == null) return NextResponse.json({ error: 'This Upgrade PIN has no complete financial snapshot.' }, { status: 400 })

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

    // Release only products newly added by the target package. Registrations
    // and upgrades never add Product Binary PU or Rank PU.
    const oldQty = new Map(resellerProfile.package!.products.map(item => [item.product_id, item.quantity]))
    const extraProducts = pin.package!.products.map(item => ({ product_id: item.product_id, quantity: item.quantity - (oldQty.get(item.product_id) || 0) })).filter(item => item.quantity > 0)
    const stock = extraProducts.length ? await prisma.inventory.findMany({ where: { owner_id: user.id, product_id: { in: extraProducts.map(item => item.product_id) } }, select: { product_id: true, quantity: true } }) : []
    if (extraProducts.some(item => (stock.find(row => row.product_id === item.product_id)?.quantity || 0) < item.quantity)) return NextResponse.json({ error: 'Insufficient City inventory for the additional upgrade products.' }, { status: 400 })

    await prisma.$transaction(async (tx) => {
      const now = new Date()
      const financial = await tx.upgradeFinancial.create({ data: {
        upgrade_pin_id: pin.id, city_dist_id: user.id, reseller_id, from_package_id: resellerProfile.package_id, to_package_id: pin.package_id,
        customer_payment: new Prisma.Decimal(pin.upgrade_customer_payment_snapshot!), reseller_value: new Prisma.Decimal(pin.upgrade_reseller_value_snapshot!), product_acquisition_cost: new Prisma.Decimal(pin.upgrade_acquisition_cost_snapshot!), pin_allocation: new Prisma.Decimal(pin.pin_allocation_snapshot!),
        registration_profit: new Prisma.Decimal(Number(pin.upgrade_reseller_value_snapshot) - Number(pin.upgrade_acquisition_cost_snapshot)),
        direct_referral_allocation: new Prisma.Decimal(pin.upgrade_direct_allocation_snapshot || 0), direct_referral_paid: new Prisma.Decimal(0), direct_referral_retained: new Prisma.Decimal(pin.upgrade_direct_allocation_snapshot || 0),
        binary_commission_allocation: new Prisma.Decimal(pin.upgrade_binary_allocation_snapshot!), binary_points_difference: Number(pin.upgrade_points_difference_snapshot),
        from_package_name_snapshot: resellerProfile.package!.name, to_package_name_snapshot: pin.package!.name, paid_at: now,
      }})
      await tx.binaryReserveLot.create({ data: { registration_financial_id: null as any, upgrade_financial_id: financial.id, original_amount: new Prisma.Decimal(pin.upgrade_binary_allocation_snapshot!), remaining_amount: new Prisma.Decimal(pin.upgrade_binary_allocation_snapshot!), snapshot_source: 'upgrade_pin_snapshot', allocated_at: now } })
      await tx.resellerProfile.update({ where: { user_id: reseller_id }, data: { package_id: pin.package_id } })
      await tx.pin.update({ where: { id: new_pin_id }, data: { status: 'used', used_by: reseller_id, used_at: now } })
      for (const item of extraProducts) await tx.inventory.update({ where: { owner_id_product_id: { owner_id: user.id, product_id: item.product_id } }, data: { quantity: { decrement: item.quantity } } })
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
      package: {
        select: {
          id:                  true,
          pairing_bonus_value: true,
        },
      },
    },
  })
  const profileMap = new Map(profiles.map((p) => [p.user_id, p]))
  const ancestorPackageIds = [...new Set(profiles.map((p) => p.package.id))]
  const binaryCaps = ancestorPackageIds.length
    ? await prisma.$queryRaw<{ id: string; enabled: boolean; cap: number }[]>`
        SELECT id::text,
               COALESCE(binary_pair_cap_enabled, true) AS enabled,
               COALESCE(daily_binary_pair_cap, 10)::int AS cap
        FROM packages
        WHERE id::text = ANY(${ancestorPackageIds}::text[])
      `
    : []
  const binaryCapMap = new Map(binaryCaps.map((row) => [row.id, row]))

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

    const pointsPerPair = Number(profile.package.pairing_bonus_value || 0)
    if (pointsPerPair <= 0) {
      await prisma.resellerProfile.update({
        where: { user_id: ancestor.user_id },
        data: { left_points: leftPts, right_points: rightPts },
      })
      continue
    }

    const pairPoints    = Math.min(leftPts, rightPts)
    const possiblePairs = Math.floor(pairPoints / pointsPerPair)

    console.log(`[UPGRADE PAIRING] ${ancestor.user_id} | leg:${leg} | L:${leftPts} R:${rightPts} | pairs:${possiblePairs}`)

    if (possiblePairs > 0) {
      const lastPairDate = profile.daily_pairing_date
        ? new Date(profile.daily_pairing_date) : null
      const isToday   = lastPairDate ? lastPairDate >= today : false
      const usedToday = isToday ? Number(profile.daily_pairing_count || 0) : 0
      const capConfig = binaryCapMap.get(profile.package.id)
      const remaining = capConfig?.enabled === false
        ? possiblePairs
        : Math.max(0, Number(capConfig?.cap ?? 10) - usedToday)

      const paidPairs     = Math.min(possiblePairs, remaining)
      const overflowPairs = possiblePairs - paidPairs

      const paidEarnings     = paidPairs     * pointsPerPair * BINARY_POINT_TO_PESO
      const overflowEarnings = overflowPairs * pointsPerPair * BINARY_POINT_TO_PESO

      const deduct = possiblePairs * pointsPerPair
      leftPts  -= deduct
      rightPts -= deduct

      if (paidPairs > 0 && paidEarnings > 0) {
        await prisma.commission.create({
          data: {
            user_id:          ancestor.user_id,
            type:             'binary_pairing',
            amount:           paidEarnings,
            points:           paidPairs * pointsPerPair,
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
            points:           overflowPairs * pointsPerPair,
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
      await prisma.$executeRaw`
        INSERT INTO pairing_logs (id, member_id, left_points_used, right_points_used, pairs_created, commission, date_created)
        VALUES (
          gen_random_uuid(),
          ${ancestor.user_id},
          ${leg === 'left' ? deduct : 0},
          ${leg === 'right' ? deduct : 0},
          ${paidPairs},
          ${paidEarnings},
          NOW()
        )
      `

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
