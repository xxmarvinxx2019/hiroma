import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getProductBinaryPairAmount } from '@/app/lib/productBinaryMatchPolicy'
import { calculateProductBinaryPool, getProductBinaryPoolWeek } from '@/app/lib/productBinaryPool'

const pesos = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const manilaTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
})

export default async function BonusesPage({ searchParams }: {
  searchParams: Promise<{ period?: string; date?: string; member?: string; recipientsPage?: string }>
}) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin' || user.is_staff) redirect('/dashboard')

  const asOf = new Date()
  const filters = await searchParams
  const memberFilter = typeof filters.member === 'string' ? filters.member.trim().slice(0, 100) : ''
  const requestedPage = Number(filters.recipientsPage)
  const recipientsPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000
    ? requestedPage : 1
  const recipientPageSize = 50
  const period = filters.period === 'daily' || filters.period === 'monthly' ? filters.period : 'weekly'
  const today = new Date(asOf.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const requested = filters.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date)
    ? new Date(`${filters.date}T00:00:00+08:00`) : null
  const date = requested && Number.isFinite(requested.getTime())
    && new Date(requested.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) === filters.date
    && filters.date <= today ? filters.date : today
  const selected = new Date(`${date}T00:00:00+08:00`)
  const dayMs = 86_400_000
  const week = getProductBinaryPoolWeek(selected)
  const [year, month] = date.split('-').map(Number)
  const { start, endExclusive } = period === 'weekly' ? week : period === 'daily'
    ? { start: selected, endExclusive: new Date(selected.getTime() + dayMs) }
    : {
      start: new Date(`${date.slice(0, 7)}-01T00:00:00+08:00`),
      endExclusive: new Date(Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000),
    }
  const { bottles, actualPaid, pool, finalized, funding, monthly, inventoryReserve, blockedRecipients, nonMemberFunding, readiness, releaseSummary, unreleased } = await prisma.$transaction(async tx => {
    const [schema] = await tx.$queryRaw<{ ready: boolean }[]>`
      SELECT to_regclass('public.product_binary_pool_weeks') IS NOT NULL AS ready
    `
    const weekKey = new Date(start.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const [weekRecord] = schema.ready && period === 'weekly' ? await tx.$queryRaw<{
      max_rate_centavos: number; allocated_centavos: bigint | null; checked: string | null; blocker: string | null
    }[]>`
      SELECT max_rate_centavos, allocated_centavos,
        to_jsonb(w)->>'readiness_checked_at' AS checked, to_jsonb(w)->>'readiness_blocker' AS blocker
      FROM product_binary_pool_weeks w WHERE week_start = ${weekKey}::date
    ` : []
    const [volume] = weekRecord ? await tx.$queryRaw<{ bottles: bigint }[]>`
      SELECT COALESCE(SUM(COALESCE((to_jsonb(o)->>'funded_units')::integer, e.eligible_units)), 0)::bigint AS bottles
      FROM product_binary_pool_orders o JOIN product_binary_order_events e ON e.id = o.order_event_id
      WHERE o.week_start = ${weekKey}::date
    ` : await tx.$queryRaw<{ bottles: bigint }[]>`
      SELECT COALESCE(SUM(eligible_units), 0)::bigint AS bottles FROM product_binary_order_events
      WHERE processed_at >= ${start} AND processed_at < ${endExclusive}
    `
    const totals = weekRecord ? await tx.$queryRaw<{ userId: string; pairs: bigint }[]>`
      SELECT e.recipient_user_id AS "userId", SUM(e.payable_pairs)::bigint AS pairs
      FROM product_binary_pool_pairs p JOIN product_binary_pair_events e ON e.id = p.pair_event_id
      WHERE p.week_start = ${weekKey}::date GROUP BY e.recipient_user_id
    ` : await tx.$queryRaw<{ userId: string; pairs: bigint }[]>`
      SELECT recipient_user_id AS "userId", SUM(payable_pairs)::bigint AS pairs
      FROM product_binary_pair_events WHERE created_at >= ${start} AND created_at < ${endExclusive}
      GROUP BY recipient_user_id
    `
    const [credits] = await tx.$queryRaw<{ paid: string }[]>`
      SELECT COALESCE(SUM(w.balance_delta), 0)::text AS paid
      FROM wallet_ledger_entries w JOIN commissions c ON c.id = w.commission_id
      WHERE w.entry_type = 'commission_credit' AND c.type = 'sponsor_point'
        AND w.created_at >= ${start} AND w.created_at < ${endExclusive}
    `
    const [pending] = weekRecord ? await tx.$queryRaw<{ cents: string; blocked: number }[]>`
      SELECT COALESCE(SUM(a.amount_centavos), 0)::text AS cents,
        COUNT(*) FILTER (WHERE a.amount_centavos > 0 AND
          (u.role <> 'reseller' OR u.status <> 'active' OR w.id IS NULL))::int AS blocked
      FROM product_binary_pool_allocations a JOIN users u ON u.id = a.recipient_user_id
      LEFT JOIN wallets w ON w.user_id = u.id
      WHERE a.week_start = ${weekKey}::date AND a.commission_id IS NULL AND to_jsonb(a)->>'retained_at' IS NULL
    ` : []
    const [releaseSummary] = weekRecord ? await tx.$queryRaw<{
      credited: string; pending: string; deferred: string; retained: string
      credited_count: number; pending_count: number; deferred_count: number; uncredited_count: number
    }[]>`
      WITH recipients AS (
        SELECT a.amount_centavos, COALESCE((to_jsonb(a)->>'partial_retained_centavos')::bigint, 0) AS partial_retained_centavos, CASE
          WHEN a.commission_id IS NOT NULL THEN 'credited'
          WHEN to_jsonb(a)->>'retained_at' IS NOT NULL THEN 'retained'
          WHEN u.status <> 'active' OR u.role <> 'reseller' OR w.id IS NULL THEN 'deferred'
          ELSE 'pending'
        END AS state
        FROM public.product_binary_pool_allocations a
        JOIN public.users u ON u.id = a.recipient_user_id
        LEFT JOIN public.wallets w ON w.user_id = u.id
        WHERE a.week_start = ${weekKey}::date AND a.amount_centavos > 0
      )
      SELECT (COALESCE(SUM(amount_centavos - partial_retained_centavos) FILTER (WHERE state = 'credited'), 0)::numeric / 100)::text AS credited,
        (COALESCE(SUM(amount_centavos) FILTER (WHERE state = 'pending'), 0)::numeric / 100)::text AS pending,
        (COALESCE(SUM(amount_centavos) FILTER (WHERE state = 'deferred'), 0)::numeric / 100)::text AS deferred,
        (COALESCE(SUM(CASE WHEN state = 'retained' THEN amount_centavos ELSE partial_retained_centavos END), 0)::numeric / 100)::text AS retained,
        COUNT(*) FILTER (WHERE state = 'credited')::int AS credited_count,
        COUNT(*) FILTER (WHERE state = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE state = 'deferred')::int AS deferred_count,
        COUNT(*) FILTER (WHERE state <> 'credited')::int AS uncredited_count
      FROM recipients
    ` : []
    const unreleased = weekRecord ? await tx.$queryRaw<{
      id: string; name: string; member: string; amount: string; reason: string
    }[]>`
      SELECT u.id, u.full_name AS name, u.member_id AS member, (a.amount_centavos::numeric / 100)::text AS amount,
        COALESCE(to_jsonb(a)->>'retained_reason', CASE
          WHEN u.status = 'inactive' THEN 'Account inactive'
          WHEN u.status = 'suspended' THEN 'Account suspended'
          WHEN wallet.id IS NULL THEN 'Wallet missing'
          WHEN w.released_at IS NULL AND to_jsonb(w)->>'release_started_at' IS NOT NULL THEN 'Queued for the next payout batch'
          WHEN w.released_at IS NULL THEN COALESCE(to_jsonb(w)->>'readiness_blocker', 'Awaiting weekly release')
          ELSE 'Awaiting credit retry'
        END) AS reason
      FROM public.product_binary_pool_allocations a JOIN public.product_binary_pool_weeks w USING (week_start)
      JOIN public.users u ON u.id=a.recipient_user_id LEFT JOIN public.wallets wallet ON wallet.user_id=u.id
      WHERE a.week_start=${weekKey}::date AND a.commission_id IS NULL AND a.amount_centavos > 0
        AND (${memberFilter} = '' OR strpos(lower(u.member_id), lower(${memberFilter})) > 0
          OR strpos(lower(u.full_name), lower(${memberFilter})) > 0)
      ORDER BY u.member_id, u.id LIMIT ${recipientPageSize + 1} OFFSET ${(recipientsPage - 1) * recipientPageSize}
    ` : []
    const [inventorySchema] = await tx.$queryRaw<{ ready: boolean }[]>`
      SELECT to_regclass('public.product_binary_inventory_reserves') IS NOT NULL AS ready
    `
    const [inventoryReserve] = inventorySchema.ready ? await tx.$queryRaw<{
      units: string; reserved: string
    }[]>`
      SELECT COALESCE(SUM(remaining_units), 0)::text AS units,
        (COALESCE(SUM(remaining_units), 0) * 5)::text AS reserved
      FROM public.product_binary_inventory_reserves
    ` : []
    const [weekFundingSchema] = await tx.$queryRaw<{ ready: boolean }[]>`
      SELECT to_regclass('public.product_binary_week_funding') IS NOT NULL AS ready
    `
    const [retainedFunding] = weekFundingSchema.ready ? await tx.$queryRaw<{ amount: string }[]>`
      SELECT (COALESCE(SUM(retained_centavos), 0)::numeric / 100)::text AS amount
      FROM public.product_binary_week_funding
    ` : []
    const [nonMemberSchema] = await tx.$queryRaw<{ ready: boolean }[]>`
      SELECT to_regclass('public.product_binary_non_member_reserve_releases') IS NOT NULL AS ready
    `
    const [nonMemberFunding] = nonMemberSchema.ready ? await tx.$queryRaw<{ amount: string }[]>`
      SELECT (COALESCE(SUM(units), 0)::numeric * 5)::text AS amount
      FROM public.product_binary_non_member_reserve_releases
    ` : []
    const [restorationSchema] = await tx.$queryRaw<{ ready: boolean }[]>`
      SELECT to_regclass('public.product_binary_non_member_reserve_restorations') IS NOT NULL AS ready
    `
    const [restoredFunding] = restorationSchema.ready ? await tx.$queryRaw<{ amount: string }[]>`
      SELECT (COALESCE(SUM(units), 0)::numeric * 5)::text AS amount
      FROM public.product_binary_non_member_reserve_restorations
    ` : []
    const netNonMemberFunding = nonMemberFunding
      ? { amount: Number(nonMemberFunding.amount) - Number(restoredFunding?.amount ?? 0) }
      : null
    const [funding] = schema.ready ? await tx.$queryRaw<{ reserve: string; outstanding: string; shortfall: string }[]>`
      WITH balances AS (
        SELECT
          GREATEST(0, (SELECT COALESCE(SUM(remaining_amount), 0) FROM product_binary_funding_lots
            WHERE remaining_amount > 0 AND allocated_at <= CURRENT_TIMESTAMP)
            - ${inventoryReserve?.reserved ?? '0'}::numeric
            - ${retainedFunding?.amount ?? '0'}::numeric
            - ${netNonMemberFunding?.amount ?? 0}::numeric
            - (SELECT COALESCE(SUM(amount_centavos), 0)::numeric / 100 FROM product_binary_pool_allocations a
               WHERE to_jsonb(a)->>'retained_at' IS NOT NULL)) AS reserve,
          (SELECT COALESCE(SUM(amount_centavos), 0)::numeric / 100
            FROM product_binary_pool_allocations
            WHERE commission_id IS NULL AND to_jsonb(product_binary_pool_allocations)->>'retained_at' IS NULL) AS outstanding
      )
      SELECT reserve::text, outstanding::text, GREATEST(0, outstanding - reserve)::text AS shortfall
      FROM balances
    ` : []
    const [monthly] = schema.ready && period === 'monthly' ? await tx.$queryRaw<{
      weeks: number; budget: string; allocated: string; retained: string
    }[]>`
      SELECT COUNT(*)::int AS weeks,
        (COALESCE(SUM(pool_centavos), 0)::numeric / 100)::text AS budget,
        (COALESCE(SUM(allocated_centavos), 0)::numeric / 100)::text AS allocated,
        (COALESCE(SUM(pool_centavos - allocated_centavos), 0)::numeric / 100)::text AS retained
      FROM product_binary_pool_weeks
      WHERE closed_at IS NOT NULL
        AND week_start + 6 >= (${start}::timestamptz AT TIME ZONE 'Asia/Manila')::date
        AND week_start + 6 < (${endExclusive}::timestamptz AT TIME ZONE 'Asia/Manila')::date
    ` : []
    const maxRate = BigInt(weekRecord?.max_rate_centavos ?? (await getProductBinaryPairAmount(tx)) * 100)
    return {
      bottles: volume.bottles,
      actualPaid: Number(credits.paid),
      pool: calculateProductBinaryPool(volume.bottles, maxRate, totals),
      funding,
      inventoryReserve,
      nonMemberFunding: netNonMemberFunding,
      monthly,
      releaseSummary,
      unreleased,
      readiness: weekRecord?.checked ? { checked: weekRecord.checked, blocker: weekRecord.blocker } : null,
      blockedRecipients: pending?.blocked ?? 0,
      finalized: weekRecord?.allocated_centavos ?? null,
    }
  }, { isolationLevel: 'RepeatableRead' })

  function recipientPageLink(page: number) {
    return `?${new URLSearchParams({ period: 'weekly', date, member: memberFilter, recipientsPage: String(page) })}#uncredited-recipients`
  }

  const projected = finalized ?? pool.allocations.reduce((sum, row) => sum + row.amountCentavos, BigInt(0))
  const metrics = [
    [period === 'weekly' ? 'Pool-funded bottles' : 'Qualified bottles', bottles.toLocaleString('en-PH')],
    ['Qualified pairs', pool.totalPairs.toLocaleString('en-PH')],
    ['Pool budget', pesos.format(Number(pool.poolCentavos) / 100)],
    [finalized === null ? 'Estimated rate per pair' : 'Final rate per pair', pesos.format(Number(pool.rateNumerator) / Number(pool.rateDenominator) / 100)],
    [finalized === null ? 'Projected commissions' : 'Finalized commissions', pesos.format(Number(projected) / 100)],
    [finalized === null ? 'Estimated unused budget' : 'Retained by Hiroma', pesos.format(Number(pool.poolCentavos - projected) / 100)],
  ]

  return (
    <main className="mx-auto max-w-5xl space-y-5">
      <h1 className="text-xl font-semibold text-[#0D1B3E]">Bonuses</h1>
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm">Period
          <select name="period" defaultValue={period} className="mt-1 block rounded border border-slate-300 p-2">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label className="text-sm">Date in period
          <input type="date" name="date" defaultValue={date} max={today} required className="mt-1 block rounded border border-slate-300 p-2" />
        </label>
        <button className="rounded bg-[#0D1B3E] px-4 py-2 text-sm text-white">Apply filter</button>
      </form>
      <section className="rounded-xl border border-slate-200 bg-white p-5 text-[#0D1B3E]">
        <h2 className="font-semibold">{period === 'weekly' ? 'Product Binary weekly pool' : 'Product Binary pool'}</h2>
        <p className="mt-1 text-sm text-slate-600">{period === 'weekly' ? 'This week’s pool budget is ₱5 per funded bottle. Projected or finalized commissions are paid from that budget. Wallet credits are shown by credit date.' : 'Pool estimates use the selected period’s processed sales and payable pairs. Weekly payout estimates use the Monday–Sunday window.'}</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 p-3">
              <dt className="text-xs text-slate-600">{label}</dt>
              <dd className="mt-1 text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-slate-200 pt-3 text-sm">Actual wallet credits in this date range <strong>{pesos.format(actualPaid)}</strong></p>
        {period === 'weekly' && (
          <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
            <h3 className="mb-2 font-semibold">Weekly wallet release</h3>
            {finalized === null && <p className="mb-2 text-slate-600">No finalized payout for this week yet.</p>}
            <p><strong>Credited</strong> {pesos.format(Number(releaseSummary?.credited ?? 0))} ({releaseSummary?.credited_count ?? 0})</p>
            <p><strong>Pending wallet credit</strong> {pesos.format(Number(releaseSummary?.pending ?? 0))} ({releaseSummary?.pending_count ?? 0})</p>
            <p><strong>Deferred wallet credit</strong> {pesos.format(Number(releaseSummary?.deferred ?? 0))} ({releaseSummary?.deferred_count ?? 0})</p>
            <p><strong>Retained by account policy</strong> {pesos.format(Number((releaseSummary?.retained ?? 0)))}</p>
            <details id="uncredited-recipients" className="mt-2" open={Boolean(memberFilter || filters.recipientsPage)}>
              <summary className="cursor-pointer font-medium">View uncredited recipients ({releaseSummary?.uncredited_count ?? 0})</summary>
              <form className="mt-3 flex flex-wrap items-end gap-2" action="#uncredited-recipients">
                <input type="hidden" name="period" value="weekly" />
                <input type="hidden" name="date" value={date} />
                <label className="text-xs">Member name or ID
                  <input name="member" defaultValue={memberFilter} maxLength={100} className="mt-1 block rounded border p-2 text-sm" />
                </label>
                <button className="rounded border px-3 py-2">Search</button>
              </form>
              {unreleased.length === 0 && <p className="mt-2 text-xs text-slate-600">No matching uncredited recipients on this page.</p>}
              <ul className="mt-2 max-h-80 divide-y overflow-auto">
                {unreleased.slice(0, recipientPageSize).map(row => <li key={row.id} className="py-2">
                  <strong>{row.name}</strong> · {row.member} · {pesos.format(Number(row.amount))}
                  <p className="text-xs text-slate-600">{row.reason}</p>
                </li>)}
              </ul>
              <nav aria-label="Uncredited recipient pages" className="mt-2 flex gap-4 text-xs">
                {recipientsPage > 1 && <a className="underline" href={recipientPageLink(recipientsPage - 1)}>Previous</a>}
                <span>Page {recipientsPage}</span>
                {unreleased.length > recipientPageSize && <a className="underline" href={recipientPageLink(recipientsPage + 1)}>Next</a>}
              </nav>
            </details>
          </div>
        )}
        {readiness && <p className="mt-2 text-sm">Last release check <strong>{readiness.blocker ? 'Held' : 'Ready'}</strong> · {manilaTime.format(new Date(readiness.checked))} Philippine time.{readiness.blocker && ` ${readiness.blocker}`}</p>}
        {blockedRecipients > 0 && <p role="status" className="mt-2 text-sm text-amber-800">{blockedRecipients} recipient bonuses are pending account activation or wallet setup.</p>}
        <p className="mt-2 text-xs text-slate-600">{manilaTime.format(start)} through {manilaTime.format(new Date(endExclusive.getTime() - 60_000))} Philippine time.</p>
        <p className="text-xs text-slate-600">Snapshot {manilaTime.format(asOf)} Philippine time.</p>
      </section>
      {monthly && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-[#0D1B3E]">
          <h2 className="font-semibold">Finalized monthly reconciliation</h2>
          <p className="mt-1 text-sm text-slate-600">Includes {monthly.weeks} finalized weeks whose Sunday cutoff falls in the selected month. Wallet credits above use their posting dates.</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ['Finalized pool budget', monthly.budget],
              ['Finalized commissions', monthly.allocated],
              ['Retained by Hiroma', monthly.retained],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-600">{label}</dt>
                <dd className="mt-1 text-lg font-semibold">{pesos.format(Number(value))}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className="rounded-xl border border-slate-200 bg-white p-5 text-[#0D1B3E]">
        <h2 className="font-semibold">Product Binary inventory reserve</h2>
        <p className="mt-1 text-sm text-slate-600">Current balance across all City Distributors. These funds are earmarked for unsold stock and excluded from available payout funding.</p>
        {inventoryReserve && Number(inventoryReserve.units) > 0 ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><dt className="text-xs text-slate-600">Remaining funded bottles</dt><dd className="font-semibold">{BigInt(inventoryReserve.units).toLocaleString('en-PH')}</dd></div>
            <div><dt className="text-xs text-slate-600">Inventory reserve</dt><dd className="font-semibold">{pesos.format(Number(inventoryReserve.reserved))}</dd></div>
          </dl>
        ) : <p className="mt-3 text-sm text-slate-600">No inventory reserve entries recorded.</p>}
      </section>
      {funding && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-[#0D1B3E]">
          <h2 className="font-semibold">Current Product Binary funding</h2>
          <p className="mt-1 text-sm text-slate-600">Network-wide balances across all weeks. Available funding excludes distributor inventory earmarks and amounts retained by Hiroma. Weekly pool budgets are allocations from funding, so these amounts should not be added together.</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ['Available funded reserve', funding.reserve],
              ['Finalized credits pending', funding.outstanding],
              ['Funding shortfall', funding.shortfall],
              ...(nonMemberFunding ? [['Retained from non-member sales', nonMemberFunding.amount]] : []),
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-600">{label}</dt>
                <dd className="mt-1 text-lg font-semibold">{pesos.format(Number(value))}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <details className="rounded-xl border border-slate-200 bg-white p-5 text-[#0D1B3E]">
        <summary className="cursor-pointer font-semibold">How Product Binary funding flows</summary>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-slate-700">
          <li><strong>Hiroma sells stock to a City Distributor.</strong> Once the eligible stock order is paid and delivered, ₱5 per bottle is earmarked in the inventory reserve. Unsold stock keeps its earmark across weekly cutoffs.</li>
          <li><strong>A reseller buys from a City Distributor.</strong> Once the resale qualifies and is processed, each funded bottle releases its existing ₱5 earmark into available payout funding and counts toward that week’s pool. An eligible bottle without a funding source can add matching volume without adding cash to the pool.</li>
          <li><strong>A reseller buys directly from Hiroma.</strong> A funded, qualified purchase adds ₱5 per bottle directly to the pool when processed. It skips the distributor inventory reserve.</li>
          <li><strong>The week closes.</strong> The final rate is the lower of the configured maximum per pair and the weekly pool divided by all payable pairs. Hiroma retains the unallocated weekly budget. The earmark for unsold stock stays in inventory reserve.</li>
        </ol>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-semibold">Example with 100 funded bottles</p>
          <p className="mt-1">Hiroma earmarks ₱500. When 60 bottles qualify through reseller purchases, ₱300 becomes available for payouts and counts toward that week’s pool. The remaining ₱200 stays earmarked for 40 bottles. The ₱300 shown in the weekly pool is part of available funding.</p>
        </div>
        <p className="mt-3 text-xs text-slate-600">The date filter applies to the period report above. Inventory reserve and available funding show current network-wide balances.</p>
      </details>
    </main>
  )
}
