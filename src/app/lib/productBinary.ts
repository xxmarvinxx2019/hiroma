import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '@/app/lib/prisma'
import { ensureCurrentProductBinaryQuarter, PRODUCT_BINARY_PESO_PER_POINT } from '@/app/lib/productBinaryQuarter'
import { calculateProductBinaryDailyCap } from '@/app/lib/productBinaryCap'
import {
  creditCommissionExactlyOnce,
  recordCommissionExactlyOnce,
} from '@/app/lib/commissionCredit'
import { lockFinancialUser } from '@/app/lib/walletLedger'
import { createAuditLog } from '@/app/lib/auditLog'

const PU_PER_LEG_PER_PAIR = 2
const PESO_PER_POINT = PRODUCT_BINARY_PESO_PER_POINT
// Business rule: Product Binary is independent from package value and may pay
// at most ₱20 per completed pair, even if a legacy rank row is configured higher.
const MAX_PRODUCT_BINARY_PAIR_RATE = 20
const PRODUCT_BINARY_RETRY_BASE_SECONDS = 30
const PRODUCT_BINARY_RETRY_MAX_SECONDS = 60 * 60

export const PRODUCT_BINARY_REWARDS_PENDING_WARNING =
  'The order is complete, but Product Binary rewards are queued for automatic retry. The durable settlement record prevents duplicate rewards.'
export const PRODUCT_BINARY_WAITING_PAYMENT_WARNING =
  'Product Binary is waiting for seller-confirmed payment. No PU, reserve, or commission is created before the order is both paid and delivered.'

type PendingSettlementActor = {
  id?: string | null
  name?: string | null
  role?: string | null
}

export function reportPendingProductBinarySettlement(
  orderId: string,
  error: unknown,
  actor: PendingSettlementActor = {},
) {
  const failure = error instanceof Error ? error.message.slice(0, 500) : 'Unknown Product Binary settlement error'
  createAuditLog({
    user_id: actor.id || null,
    user_name: actor.name || undefined,
    user_role: actor.role || undefined,
    activity_type: 'product_binary_settlement_queued',
    category: 'commission',
    description: `Product Binary rewards for order ${orderId} remain queued for automatic retry.`,
    metadata: {
      order_id: orderId,
      durable_settlement_job: true,
      failure,
    },
    risk_level: 'warning',
    status: 'under_review',
  })
  return {
    rewards_pending: true as const,
    rewards_warning: PRODUCT_BINARY_REWARDS_PENDING_WARNING,
  }
}

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
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'product-binary:' + orderId}))`
      const jobs = await tx.$queryRaw<{
        id: string
        status: string
        qualification_status: string
        buyer_user_id: string | null
        eligible_units_snapshot: number | null
        total_pu_snapshot: number | null
        gross_margin_snapshot: string | null
        snapshot_version: string | null
      }[]>`
        SELECT id::text,status,qualification_status,buyer_user_id::text,
          eligible_units_snapshot,total_pu_snapshot,gross_margin_snapshot::text,snapshot_version
        FROM product_binary_settlement_jobs
        WHERE order_id=${orderId}
        FOR UPDATE
      `
      const job = jobs[0]
      if (!job) {
        throw new Error('Product Binary order has no database-qualified settlement job.')
      }
      if (job.status === 'completed') {
        if (job.qualification_status === 'ineligible_zero_pu') {
          return { processed: false, reason: 'not_eligible' as const }
        }
        return { processed: false, reason: 'already_processed' as const }
      }
      if (job.status === 'waiting_payment') {
        return { processed: false, reason: 'waiting_for_payment' as const }
      }
      if (job.status === 'reconciliation_required') {
        return { processed: false, reason: 'reconciliation_required' as const }
      }
      if (!['pending', 'failed'].includes(job.status)
          || job.qualification_status !== 'qualified_paid_delivery'
          || job.snapshot_version !== 'product-binary-order-v1'
          || !job.buyer_user_id
          || Number(job.total_pu_snapshot) <= 0
          || Number(job.eligible_units_snapshot) <= 0
          || job.gross_margin_snapshot === null) {
        throw new Error('Product Binary settlement job lacks exact paid-delivered snapshots.')
      }

      const existing = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM product_binary_order_events WHERE order_id = ${orderId} LIMIT 1
      `
      if (existing.length) {
        await tx.$executeRaw`
          UPDATE product_binary_settlement_jobs
          SET status='completed',completed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
          WHERE order_id=${orderId}
        `
        return { processed: false, reason: 'already_processed' as const }
      }

      const order = {
        order_id: orderId,
        buyer_id: job.buyer_user_id,
        eligible_units: Number(job.eligible_units_snapshot),
        total_pu: Number(job.total_pu_snapshot),
        gross_margin: Number(job.gross_margin_snapshot),
      }

    const orderEventId = randomUUID()
    await tx.$executeRaw`
      INSERT INTO product_binary_order_events(
        id,order_id,buyer_user_id,eligible_units,total_pu,recorded_gross_margin,settlement_job_id
      )
      VALUES(
        ${orderEventId}::uuid,${order.order_id},${order.buyer_id},${Number(order.eligible_units)},
        ${Number(order.total_pu)},${Number(order.gross_margin)},${job.id}::uuid
      )
    `

    // Personal PU drives Rank Engine. Registration/package products are not
    // counted here; only a delivered, binary-eligible product order is counted.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'product-binary-user:' + order.buyer_id}))`
    await lockFinancialUser(tx, order.buyer_id)
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
    const hiroma = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text
      FROM users
      WHERE username='hiroma' AND role='admin'::"Role" AND status='active'::"UserStatus"
      LIMIT 1
    `
    const day = manilaDayRange(new Date())
    let credited = 0
    let flashout = 0

    for (const ancestor of ancestors) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'product-binary-user:' + ancestor.user_id}))`
      await lockFinancialUser(tx, ancestor.user_id)
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
      const positions = await tx.$queryRaw<{
        left_carryover_pu: number; right_carryover_pu: number;
        lifetime_pairs: number; lifetime_payable: number; lifetime_flashout: number;
      }[]>`
        SELECT left_carryover_pu,right_carryover_pu,lifetime_pairs,lifetime_payable,lifetime_flashout
        FROM product_binary_positions
        WHERE user_id=${ancestor.user_id} FOR UPDATE
      `
      const openingLeft = Number(positions[0]?.left_carryover_pu || 0)
      const openingRight = Number(positions[0]?.right_carryover_pu || 0)
      const openingLifetimePairs = Number(positions[0]?.lifetime_pairs || 0)
      const openingLifetimePayable = Number(positions[0]?.lifetime_payable || 0)
      const openingLifetimeFlashout = Number(positions[0]?.lifetime_flashout || 0)
      const availableLeft = openingLeft + (ancestor.source_leg === 'left' ? Number(order.total_pu) : 0)
      const availableRight = openingRight + (ancestor.source_leg === 'right' ? Number(order.total_pu) : 0)
      const completedPairs = Math.floor(Math.min(availableLeft, availableRight) / PU_PER_LEG_PER_PAIR)
      const closingLeft = availableLeft - completedPairs * PU_PER_LEG_PER_PAIR
      const closingRight = availableRight - completedPairs * PU_PER_LEG_PER_PAIR

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
      const closingLifetimePairs = openingLifetimePairs + completedPairs
      const closingLifetimePayable = openingLifetimePayable + payablePairs
      const closingLifetimeFlashout = openingLifetimeFlashout + capFlashPairs + inactivePairs

      if (flashoutAmount > 0 && !hiroma[0]) {
        throw new Error('Hiroma product-binary flashout receiver was not found.')
      }

      let normalCommissionId: string | null = null
      let flashCommissionId: string | null = null

      if (payableAmount > 0) {
        const normalCommission = await creditCommissionExactlyOnce(tx, {
          eventKey: `product-order:${order.order_id}:binary:${ancestor.user_id}:payable`,
          sourceEventKind: 'product_order',
          sourceEventId: order.order_id,
          ruleVersion: 'product-binary-v1',
          userId: ancestor.user_id,
          type: 'sponsor_point',
          amount: payableAmount,
          points: payablePairs*effectiveRatePoints,
          sourceUserId: order.buyer_id,
        })
        normalCommissionId = normalCommission.id
        credited += payableAmount
      }
      if (flashoutAmount > 0 && hiroma[0]) {
        const flashCommission = await recordCommissionExactlyOnce(tx, {
          eventKey: `product-order:${order.order_id}:binary:${ancestor.user_id}:flashout`,
          sourceEventKind: 'product_order',
          sourceEventId: order.order_id,
          ruleVersion: 'product-binary-v1',
          userId: hiroma[0].id,
          type: 'sponsor_point',
          amount: flashoutAmount,
          points: (capFlashPairs+inactivePairs)*effectiveRatePoints,
          sourceUserId: order.buyer_id,
          isOverflow: true,
          overflowTo: hiroma[0].id,
        })
        flashCommissionId = flashCommission.id
        flashout += flashoutAmount
      }

      await tx.$executeRaw`
        INSERT INTO product_binary_pair_events(
          id,order_event_id,recipient_user_id,source_user_id,source_leg,source_pu,opening_left_pu,opening_right_pu,
          opening_lifetime_pairs,opening_lifetime_payable,opening_lifetime_flashout,
          completed_pairs,payable_pairs,cap_flashout_pairs,inactive_flashout_pairs,closing_left_pu,closing_right_pu,
          closing_lifetime_pairs,closing_lifetime_payable,closing_lifetime_flashout,
          package_id_snapshot,package_name_snapshot,rank_id_snapshot,rank_name_snapshot,pair_rate_points,peso_per_point,
          pair_rate_amount,payable_amount,flashout_amount,cap_enabled,cap_limit,normal_commission_id,flashout_commission_id)
        VALUES(${randomUUID()}::uuid,${orderEventId}::uuid,${ancestor.user_id},${order.buyer_id},${ancestor.source_leg},${Number(order.total_pu)},
          ${openingLeft},${openingRight},${openingLifetimePairs},${openingLifetimePayable},${openingLifetimeFlashout},
          ${completedPairs},${payablePairs},${capFlashPairs},${inactivePairs},${closingLeft},${closingRight},
          ${closingLifetimePairs},${closingLifetimePayable},${closingLifetimeFlashout},
          ${profile.package_id},${profile.package_name},${rank?.id || null},${rank?.name || 'Default'},${effectiveRatePoints},${PESO_PER_POINT},
          ${rateAmount},${payableAmount},${flashoutAmount},${profile.cap_enabled},${profile.cap_enabled ? Number(profile.cap_limit) : null},${normalCommissionId},${flashCommissionId})
      `
      await tx.$executeRaw`
        UPDATE product_binary_positions SET left_carryover_pu=${closingLeft},right_carryover_pu=${closingRight},
          lifetime_pairs=${closingLifetimePairs},lifetime_payable=${closingLifetimePayable},
          lifetime_flashout=${closingLifetimeFlashout},updated_at=CURRENT_TIMESTAMP WHERE user_id=${ancestor.user_id}
      `
      await tx.$executeRaw`UPDATE reseller_profiles SET total_points=COALESCE(total_points,0)+${payablePairs*effectiveRatePoints} WHERE user_id=${ancestor.user_id}`
    }
      await tx.$executeRaw`
        UPDATE product_binary_settlement_jobs
        SET status='completed',completed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE order_id=${orderId}
      `
      return { processed: true, orderPu: Number(order.total_pu), credited, flashout }
    }, { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown Product Binary settlement error'
    try {
      await prisma.$executeRaw`
        UPDATE product_binary_settlement_jobs
        SET status='failed',attempts=attempts+1,last_error=${message},
            next_attempt_at=CURRENT_TIMESTAMP + make_interval(
              secs => LEAST(
                ${PRODUCT_BINARY_RETRY_MAX_SECONDS},
                (${PRODUCT_BINARY_RETRY_BASE_SECONDS} * power(2, LEAST(attempts, 7)))::integer
              )
            ),
            updated_at=CURRENT_TIMESTAMP
        WHERE order_id=${orderId} AND status<>'completed'
      `
    } catch (recordError) {
      console.error('[PRODUCT BINARY] Failed to record settlement failure:', recordError)
    }
    throw error
  }
}
