import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '@/app/lib/prisma'
import { ensureCurrentProductBinaryQuarter, PRODUCT_BINARY_PESO_PER_POINT } from '@/app/lib/productBinaryQuarter'
import { calculateProductBinaryDailyCap } from '@/app/lib/productBinaryCap'

const PU_PER_LEG_PER_PAIR = 2
const PESO_PER_POINT = PRODUCT_BINARY_PESO_PER_POINT
// Business rule: Product Binary is independent from package value and may pay
// at most ₱20 per completed pair, even if a legacy rank row is configured higher.
const MAX_PRODUCT_BINARY_PAIR_RATE = 20

type Tx = Prisma.TransactionClient

function manilaDayRange(at: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  const day = `${get('year')}-${get('month')}-${get('day')}`
  return {
    start: new Date(`${day}T00:00:00+08:00`),
    end: new Date(`${day}T23:59:59.999+08:00`),
  }
}

async function getRankSnapshot(tx: Tx, packageId: string | null, totalPu: number) {
  if (!packageId) return null
  const rows = await tx.$queryRaw<{ id: string; name: string; pair_income: string }[]>`
    SELECT r.id::text, r.name, r.pair_income::text
    FROM ranks r
    WHERE r.package_id::text = ${packageId}
      AND r.required_pu <= ${totalPu}
    ORDER BY r.sequence DESC LIMIT 1
  `
  return rows[0] || null
}

/**
 * Applies one delivered reseller product order exactly once. Every financial
 * result is snapshotted, so later rank/package edits cannot rewrite history.
 */
export async function processDeliveredProductBinaryOrder(orderId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'product-binary:' + orderId}))`

    const existing = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM product_binary_order_events WHERE order_id = ${orderId} LIMIT 1
    `
    if (existing.length) return { processed: false, reason: 'already_processed' as const }

    const orders = await tx.$queryRaw<{
      order_id: string; buyer_id: string; buyer_role: string; status: string;
      eligible_units: number; total_pu: number; gross_margin: string;
    }[]>`
      SELECT o.id::text order_id, o.buyer_id::text, u.role::text buyer_role, o.status::text,
        COALESCE(SUM(CASE WHEN p.binary_eligible AND p.pu_value > 0 THEN oi.quantity ELSE 0 END),0)::int eligible_units,
        COALESCE(SUM(CASE WHEN p.binary_eligible AND p.pu_value > 0 THEN oi.quantity*p.pu_value ELSE 0 END),0)::int total_pu,
        COALESCE(SUM(CASE WHEN p.binary_eligible AND p.pu_value > 0
          THEN oi.quantity*(oi.unit_price-COALESCE(oi.unit_acquisition_cost,p.cost_price)) ELSE 0 END),0)::text gross_margin
      FROM orders o JOIN users u ON u.id=o.buyer_id JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id
      WHERE o.id::text=${orderId}
      GROUP BY o.id,o.buyer_id,u.role,o.status
    `
    const order = orders[0]
    if (!order || order.status !== 'delivered' || order.buyer_role !== 'reseller' || Number(order.total_pu) <= 0) {
      return { processed: false, reason: 'not_eligible' as const }
    }

    const orderEventId = randomUUID()
    await tx.$executeRaw`
      INSERT INTO product_binary_order_events(id,order_id,buyer_user_id,eligible_units,total_pu,recorded_gross_margin)
      VALUES(${orderEventId}::uuid,${order.order_id},${order.buyer_id},${Number(order.eligible_units)},${Number(order.total_pu)},${Number(order.gross_margin)})
    `

    // Personal PU drives Rank Engine. Registration/package products are not
    // counted here; only a delivered, binary-eligible product order is counted.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'product-binary-user:' + order.buyer_id}))`
    await ensureCurrentProductBinaryQuarter(tx, order.buyer_id)
    await tx.$executeRaw`
      UPDATE reseller_profiles SET total_pu=COALESCE(total_pu,0)+${Number(order.total_pu)} WHERE user_id=${order.buyer_id}
    `
    const buyerProfile = await tx.$queryRaw<{ package_id: string; total_pu: number }[]>`
      SELECT package_id::text,total_pu FROM reseller_profiles WHERE user_id=${order.buyer_id} LIMIT 1
    `
    if (buyerProfile[0]) {
      const buyerRank = await getRankSnapshot(tx, buyerProfile[0].package_id, Number(buyerProfile[0].total_pu))
      await tx.$executeRaw`UPDATE reseller_profiles SET rank=${buyerRank?.name || 'default'} WHERE user_id=${order.buyer_id}`
    }

    const ancestors = await tx.$queryRaw<{
      user_id: string; source_leg: 'left' | 'right'; depth: number;
    }[]>`
      WITH RECURSIVE chain AS (
        SELECT p.id,p.user_id,p.parent_id,b.position::text source_leg,1 depth
        FROM binary_tree_nodes b JOIN binary_tree_nodes p ON p.id=b.parent_id
        WHERE b.user_id=${order.buyer_id}
        UNION ALL
        SELECT p.id,p.user_id,p.parent_id,cnode.position::text,c.depth+1
        FROM chain c JOIN binary_tree_nodes cnode ON cnode.id=c.id
        JOIN binary_tree_nodes p ON p.id=c.parent_id
      ) SELECT user_id::text,source_leg,depth FROM chain ORDER BY depth
    `
    const hiroma = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM users WHERE username='hiroma' LIMIT 1`
    const day = manilaDayRange(new Date())
    let credited = 0
    let flashout = 0

    for (const ancestor of ancestors) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'product-binary-user:' + ancestor.user_id}))`
      await ensureCurrentProductBinaryQuarter(tx, ancestor.user_id)
      const profiles = await tx.$queryRaw<{
        status: string; package_id: string; package_name: string; base_points: string; total_pu: number;
        cap_enabled: boolean; cap_limit: number;
      }[]>`
        SELECT u.status::text,rp.package_id::text,p.name package_name,p.point_php_value::text base_points,
          COALESCE(rp.total_pu,0)::int total_pu,COALESCE(p.product_binary_cap_enabled,true) cap_enabled,
          COALESCE(p.daily_product_pairing_cap,50)::int cap_limit
        FROM reseller_profiles rp JOIN users u ON u.id=rp.user_id JOIN packages p ON p.id=rp.package_id
        WHERE rp.user_id=${ancestor.user_id} LIMIT 1
      `
      const profile = profiles[0]
      if (!profile) continue
      const rank = await getRankSnapshot(tx, profile.package_id, Number(profile.total_pu))
      const ratePoints = Number(rank?.pair_income ?? profile.base_points)
      const rateAmount = Math.min(ratePoints * PESO_PER_POINT, MAX_PRODUCT_BINARY_PAIR_RATE)
      const effectiveRatePoints = rateAmount / PESO_PER_POINT

      await tx.$executeRaw`
        INSERT INTO product_binary_positions(user_id) VALUES(${ancestor.user_id}) ON CONFLICT(user_id) DO NOTHING
      `
      const positions = await tx.$queryRaw<{ left_carryover_pu: number; right_carryover_pu: number }[]>`
        SELECT left_carryover_pu,right_carryover_pu FROM product_binary_positions
        WHERE user_id=${ancestor.user_id} FOR UPDATE
      `
      const openingLeft = Number(positions[0]?.left_carryover_pu || 0)
      const openingRight = Number(positions[0]?.right_carryover_pu || 0)
      const availableLeft = openingLeft + (ancestor.source_leg === 'left' ? Number(order.total_pu) : 0)
      const availableRight = openingRight + (ancestor.source_leg === 'right' ? Number(order.total_pu) : 0)
      const completedPairs = Math.floor(Math.min(availableLeft, availableRight) / PU_PER_LEG_PER_PAIR)
      const closingLeft = availableLeft - completedPairs * PU_PER_LEG_PER_PAIR
      const closingRight = availableRight - completedPairs * PU_PER_LEG_PER_PAIR
      if (completedPairs <= 0) {
        await tx.$executeRaw`UPDATE product_binary_positions SET left_carryover_pu=${closingLeft},right_carryover_pu=${closingRight},updated_at=CURRENT_TIMESTAMP WHERE user_id=${ancestor.user_id}`
        continue
      }

      const today = await tx.$queryRaw<{ used: number }[]>`
        SELECT COALESCE(SUM(payable_pairs),0)::int used FROM product_binary_pair_events
        WHERE recipient_user_id=${ancestor.user_id} AND created_at>=${day.start} AND created_at<=${day.end}
      `
      const used = Number(today[0]?.used || 0)
      const { payablePairs, capFlashPairs, inactivePairs } = calculateProductBinaryDailyCap(
        completedPairs,
        used,
        profile.cap_enabled,
        Number(profile.cap_limit),
        profile.status === 'active',
      )
      const payableAmount = payablePairs*rateAmount
      const flashoutAmount = (capFlashPairs+inactivePairs)*rateAmount
      let normalCommissionId: string | null = null
      let flashCommissionId: string | null = null

      if (payableAmount > 0) {
        normalCommissionId=randomUUID()
        await tx.$executeRaw`INSERT INTO commissions(id,user_id,type,amount,points,source_user_id,is_pair_overflow,created_at)
          VALUES(${normalCommissionId},${ancestor.user_id},'sponsor_point'::"CommissionType",${payableAmount},${payablePairs*effectiveRatePoints},${order.buyer_id},false,CURRENT_TIMESTAMP)`
        await tx.$executeRaw`INSERT INTO wallets(id,user_id,balance,total_earned,total_withdrawn,updated_at)
          VALUES(${randomUUID()},${ancestor.user_id},${payableAmount},${payableAmount},0,CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET balance=wallets.balance+${payableAmount},total_earned=wallets.total_earned+${payableAmount},updated_at=CURRENT_TIMESTAMP`
        credited += payableAmount
      }
      if (flashoutAmount > 0 && hiroma[0]) {
        flashCommissionId=randomUUID()
        await tx.$executeRaw`INSERT INTO commissions(id,user_id,type,amount,points,source_user_id,is_pair_overflow,overflow_to,created_at)
          VALUES(${flashCommissionId},${hiroma[0].id},'sponsor_point'::"CommissionType",${flashoutAmount},${(capFlashPairs+inactivePairs)*effectiveRatePoints},${order.buyer_id},true,${hiroma[0].id},CURRENT_TIMESTAMP)`
        await tx.$executeRaw`INSERT INTO wallets(id,user_id,balance,total_earned,total_withdrawn,updated_at)
          VALUES(${randomUUID()},${hiroma[0].id},${flashoutAmount},${flashoutAmount},0,CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET balance=wallets.balance+${flashoutAmount},total_earned=wallets.total_earned+${flashoutAmount},updated_at=CURRENT_TIMESTAMP`
        flashout += flashoutAmount
      }

      await tx.$executeRaw`
        INSERT INTO product_binary_pair_events(
          id,order_event_id,recipient_user_id,source_user_id,source_leg,source_pu,opening_left_pu,opening_right_pu,
          completed_pairs,payable_pairs,cap_flashout_pairs,inactive_flashout_pairs,closing_left_pu,closing_right_pu,
          package_id_snapshot,package_name_snapshot,rank_id_snapshot,rank_name_snapshot,pair_rate_points,peso_per_point,
          pair_rate_amount,payable_amount,flashout_amount,cap_enabled,cap_limit,normal_commission_id,flashout_commission_id)
        VALUES(${randomUUID()}::uuid,${orderEventId}::uuid,${ancestor.user_id},${order.buyer_id},${ancestor.source_leg},${Number(order.total_pu)},
          ${openingLeft},${openingRight},${completedPairs},${payablePairs},${capFlashPairs},${inactivePairs},${closingLeft},${closingRight},
          ${profile.package_id},${profile.package_name},${rank?.id || null},${rank?.name || 'Default'},${effectiveRatePoints},${PESO_PER_POINT},
          ${rateAmount},${payableAmount},${flashoutAmount},${profile.cap_enabled},${profile.cap_enabled ? Number(profile.cap_limit) : null},${normalCommissionId},${flashCommissionId})
      `
      await tx.$executeRaw`
        UPDATE product_binary_positions SET left_carryover_pu=${closingLeft},right_carryover_pu=${closingRight},
          lifetime_pairs=lifetime_pairs+${completedPairs},lifetime_payable=lifetime_payable+${payablePairs},
          lifetime_flashout=lifetime_flashout+${capFlashPairs+inactivePairs},updated_at=CURRENT_TIMESTAMP WHERE user_id=${ancestor.user_id}
      `
      await tx.$executeRaw`UPDATE reseller_profiles SET total_points=COALESCE(total_points,0)+${payablePairs*effectiveRatePoints} WHERE user_id=${ancestor.user_id}`
    }
    return { processed: true, orderPu: Number(order.total_pu), credited, flashout }
  }, { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
