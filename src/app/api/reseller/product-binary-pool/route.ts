import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getProductBinaryPairAmount } from '@/app/lib/productBinaryMatchPolicy'
import { calculateProductBinaryPool, getProductBinaryPoolWeek } from '@/app/lib/productBinaryPool'

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'reseller') {
    return NextResponse.json({ error: 'Reseller access required.' }, { status: 403 })
  }

  const asOf = new Date()
  const { start, endExclusive } = getProductBinaryPoolWeek(asOf)
  try {
    const preview = await prisma.$transaction(async tx => {
      const [schema] = await tx.$queryRaw<{ ready: boolean; expiryPreview: boolean }[]>`
        SELECT to_regprocedure('public.credit_product_binary_pool_allocation(date,text)') IS NOT NULL AS ready,
          to_regprocedure('public.product_binary_surviving_pairs(date,text)') IS NOT NULL AS "expiryPreview"
      `
      const week = new Date(start.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const [config] = schema.ready ? await tx.$queryRaw<{ active: boolean; max_rate: number | null }[]>`
        SELECT EXISTS (
          SELECT 1 FROM system_settings
          WHERE key = 'product_binary_weekly_cutover' AND value::date <= ${week}::date
        ) AS active, (SELECT max_rate_centavos FROM product_binary_pool_weeks
          WHERE week_start = ${week}::date) AS max_rate
      ` : []
      const active = config?.active === true
      const [latest] = active ? await tx.$queryRaw<{
        week: string; amount: string; credited: boolean; retained: boolean
        pool_centavos: bigint; total_pairs: bigint; max_rate_centavos: number
      }[]>`
        SELECT to_char(a.week_start, 'YYYY-MM-DD') AS week,
          (a.amount_centavos - COALESCE((to_jsonb(a)->>'partial_retained_centavos')::bigint, 0))::text AS amount,
          a.commission_id IS NOT NULL AS credited, to_jsonb(a)->>'retained_at' IS NOT NULL AS retained,
          w.pool_centavos, w.total_pairs, w.max_rate_centavos
        FROM product_binary_pool_allocations a JOIN product_binary_pool_weeks w USING (week_start)
        WHERE a.recipient_user_id = ${user.id} AND w.closed_at IS NOT NULL
        ORDER BY a.week_start DESC LIMIT 1
      ` : []
      type Totals = { bottles: bigint; pairs: bigint; own_pairs: bigint }
      const [totals] = active ? await tx.$queryRaw<Totals[]>`
        SELECT
          (SELECT COALESCE(SUM(COALESCE((to_jsonb(o)->>'funded_units')::integer, e.eligible_units)), 0)::bigint
           FROM product_binary_pool_orders o JOIN product_binary_order_events e ON e.id = o.order_event_id
           WHERE o.week_start = ${week}::date) AS bottles,
          COALESCE(SUM(e.payable_pairs), 0)::bigint AS pairs,
          COALESCE(SUM(e.payable_pairs) FILTER (WHERE e.recipient_user_id = ${user.id}), 0)::bigint AS own_pairs
        FROM product_binary_pool_pairs p JOIN product_binary_pair_events e ON e.id = p.pair_event_id
        WHERE p.week_start = ${week}::date
      ` : await tx.$queryRaw<Totals[]>`
        SELECT
          (SELECT COALESCE(SUM(eligible_units), 0)::bigint FROM product_binary_order_events
            WHERE processed_at >= ${start} AND processed_at < ${endExclusive}) AS bottles,
          COALESCE(SUM(payable_pairs), 0)::bigint AS pairs,
          COALESCE(SUM(payable_pairs) FILTER (WHERE recipient_user_id = ${user.id}), 0)::bigint AS own_pairs
        FROM product_binary_pair_events
        WHERE created_at >= ${start} AND created_at < ${endExclusive}
      `
      const maxRate = BigInt(config?.max_rate ?? (await getProductBinaryPairAmount(tx)) * 100)
      const result = calculateProductBinaryPool(totals.bottles, maxRate, [
        { userId: user.id, pairs: totals.own_pairs },
        { userId: 'network-remainder', pairs: totals.pairs - totals.own_pairs },
      ])
      const [expiry] = active && schema.expiryPreview ? await tx.$queryRaw<{
        current_pairs: bigint | null; finalized_pairs: bigint | null
      }[]>`
        SELECT public.product_binary_surviving_pairs(${week}::date, ${user.id}) AS current_pairs,
          CASE WHEN ${Boolean(latest && !latest.credited && !latest.retained)}
            THEN public.product_binary_surviving_pairs(${latest?.week ?? null}::date, ${user.id})
          END AS finalized_pairs
      ` : []
      const ownPairs = expiry?.current_pairs ?? totals.own_pairs
      let latestAmount = latest?.amount
      if (latest && expiry?.finalized_pairs != null && latest.total_pairs > BigInt(0)) {
        const capped = latest.total_pairs * BigInt(latest.max_rate_centavos)
        const distributable = latest.pool_centavos < capped ? latest.pool_centavos : capped
        latestAmount = (expiry.finalized_pairs * distributable / latest.total_pairs).toString()
      }

      return {
        mode: active ? 'weekly' : 'simulation',
        latest: latest ? { week: latest.week, amount: latestAmount ?? latest.amount, credited: latest.credited, retained: latest.retained } : null,
        start: start.toISOString(),
        endExclusive: endExclusive.toISOString(),
        asOf: asOf.toISOString(),
        qualifiedPairs: ownPairs.toString(),
        pairShare: totals.pairs > BigInt(0) ? Number(ownPairs) / Number(totals.pairs) : 0,
        estimatedRate: (Number(result.rateNumerator) / Number(result.rateDenominator) / 100).toFixed(4),
        estimatedBonusCentavos: (ownPairs * result.rateNumerator / result.rateDenominator).toString(),
      }
    }, { isolationLevel: 'RepeatableRead' })

    return NextResponse.json(preview, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[PRODUCT BINARY POOL PREVIEW]', error)
    return NextResponse.json({ error: 'Unable to load the weekly pool preview.' }, { status: 500 })
  }
}
