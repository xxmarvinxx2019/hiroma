import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const date = (value: string | null, end=false) => value && /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? new Date(`${value}T${end?'23:59:59.999':'00:00:00'}+08:00`) : null
const n = (v: unknown) => Number(v || 0) || 0

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const now = new Date()
  const from = date(req.nextUrl.searchParams.get('from')) || new Date(now.getFullYear(),now.getMonth(),1)
  const to = date(req.nextUrl.searchParams.get('to'),true) || now
  try {
    const [summary, payout, liability, carryover, ranks, ledger, legacy, funding, companyMargin] = await Promise.all([
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT COALESCE(SUM(o.eligible_units),0)::int eligible_units,COALESCE(SUM(o.total_pu),0)::int total_pu,
          COALESCE(SUM(o.recorded_gross_margin),0)::float recorded_gross_margin,
          COALESCE((SELECT SUM(completed_pairs) FROM product_binary_pair_events WHERE created_at>=${from} AND created_at<=${to}),0)::int completed_pairs,
          COALESCE((SELECT SUM(payable_pairs) FROM product_binary_pair_events WHERE created_at>=${from} AND created_at<=${to}),0)::int payable_pairs,
          COALESCE((SELECT SUM(payable_amount) FROM product_binary_pair_events WHERE created_at>=${from} AND created_at<=${to}),0)::float earned,
          COALESCE((SELECT SUM(flashout_amount) FROM product_binary_pair_events WHERE created_at>=${from} AND created_at<=${to}),0)::float flashout,
          COALESCE((SELECT SUM(cap_flashout_pairs) FROM product_binary_pair_events WHERE created_at>=${from} AND created_at<=${to}),0)::int cap_flashout_pairs,
          COALESCE((SELECT SUM(inactive_flashout_pairs) FROM product_binary_pair_events WHERE created_at>=${from} AND created_at<=${to}),0)::int inactive_flashout_pairs,
          COALESCE((SELECT AVG(pair_rate_amount) FROM product_binary_pair_events WHERE created_at>=${from} AND created_at<=${to}),0)::float average_rate
        FROM product_binary_order_events o WHERE o.processed_at>=${from} AND o.processed_at<=${to}
      `,
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT
          COALESCE(SUM(CASE WHEN p.status='approved' THEN c.amount ELSE 0 END),0)::float approved,
          COALESCE(SUM(CASE WHEN p.status='released' THEN c.amount ELSE 0 END),0)::float paid
        FROM product_binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id
        WHERE COALESCE(p.processed_at,p.requested_at)>=${from} AND COALESCE(p.processed_at,p.requested_at)<=${to}
      `,
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT
          (COALESCE(SUM(l.original_amount),0)-COALESCE((
            SELECT SUM(c.amount) FROM product_binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id
            WHERE p.status='released' AND COALESCE(p.processed_at,p.requested_at)<=${to}
          ),0))::float payable_liability,
          COALESCE(SUM(l.original_amount),0)::float lifetime_earned
        FROM product_binary_payable_lots l WHERE l.allocated_at<=${to}
      `,
      prisma.$queryRaw<Record<string, unknown>[]>`SELECT COALESCE(SUM(left_carryover_pu),0)::int left_pu,COALESCE(SUM(right_carryover_pu),0)::int right_pu FROM product_binary_positions`,
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT rank_name_snapshot rank_name,MAX(pair_rate_amount)::float pair_rate,
          COUNT(DISTINCT recipient_user_id)::int members,COALESCE(SUM(completed_pairs),0)::int completed_pairs,
          COALESCE(SUM(payable_pairs),0)::int payable_pairs,COALESCE(SUM(payable_amount),0)::float earned,
          COALESCE(SUM(cap_flashout_pairs+inactive_flashout_pairs),0)::int flashout_pairs,
          COALESCE(SUM(flashout_amount),0)::float flashout
        FROM product_binary_pair_events WHERE created_at>=${from} AND created_at<=${to}
        GROUP BY rank_name_snapshot ORDER BY pair_rate
      `,
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT e.id::text,e.created_at,u.full_name recipient_name,u.username recipient_username,
          s.full_name source_name,s.username source_username,e.source_leg,e.source_pu,e.package_name_snapshot,
          e.rank_name_snapshot,e.pair_rate_amount::float,e.completed_pairs,e.payable_pairs,
          e.cap_flashout_pairs,e.inactive_flashout_pairs,e.payable_amount::float,e.flashout_amount::float,
          e.closing_left_pu,e.closing_right_pu,o.order_id
        FROM product_binary_pair_events e JOIN product_binary_order_events o ON o.id=e.order_event_id
        JOIN users u ON u.id=e.recipient_user_id JOIN users s ON s.id=e.source_user_id
        WHERE e.created_at>=${from} AND e.created_at<=${to} ORDER BY e.created_at DESC LIMIT 200
      `,
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT COALESCE(SUM(CASE WHEN is_pair_overflow=false THEN amount ELSE 0 END),0)::float earned,
          COALESCE(SUM(CASE WHEN is_pair_overflow=true THEN amount ELSE 0 END),0)::float flashout,
          COUNT(*) FILTER(WHERE is_pair_overflow=false)::int events
        FROM commissions WHERE type='sponsor_point' AND created_at>=${from} AND created_at<=${to}
          AND id NOT IN (SELECT COALESCE(normal_commission_id,'') FROM product_binary_pair_events UNION SELECT COALESCE(flashout_commission_id,'') FROM product_binary_pair_events)
      `,
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT
          COALESCE(SUM(CASE WHEN f.allocated_at>=${from} AND f.allocated_at<=${to} THEN f.original_amount ELSE 0 END),0)::float allocated_period,
          COALESCE(SUM(f.original_amount),0)::float allocated_to_date,
          (COALESCE(SUM(CASE WHEN f.allocated_at<${from} THEN f.original_amount ELSE 0 END),0)-COALESCE((SELECT SUM(c.amount) FROM product_binary_funding_consumptions c WHERE c.is_unfunded=false AND c.consumed_at<${from}),0))::float opening_available,
          (COALESCE(SUM(f.original_amount),0)-COALESCE((SELECT SUM(c.amount) FROM product_binary_funding_consumptions c WHERE c.is_unfunded=false AND c.consumed_at<=${to}),0))::float available_fund,
          COALESCE((SELECT SUM(c.amount) FROM product_binary_funding_consumptions c WHERE c.is_unfunded=false AND c.consumed_at>=${from} AND c.consumed_at<=${to}),0)::float funded_usage_period,
          COALESCE((SELECT SUM(c.amount) FROM product_binary_funding_consumptions c WHERE c.is_unfunded=true AND c.consumed_at>=${from} AND c.consumed_at<=${to}),0)::float unfunded_period,
          COALESCE((SELECT SUM(c.amount) FROM product_binary_funding_consumptions c WHERE c.is_unfunded=true AND c.consumed_at<=${to}),0)::float unfunded_to_date
        FROM product_binary_funding_lots f WHERE f.allocated_at<=${to}
      `,
      prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT COALESCE(SUM(im.admin_profit),0)::float gross_margin,
          COALESCE(SUM(im.quantity),0)::int eligible_products_sold
        FROM inventory_movements im JOIN products p ON p.id::text=im.product_id::text
        WHERE im.is_sale=true AND p.binary_eligible=true AND im.created_at>=${from} AND im.created_at<=${to}
      `,
    ])
    const s=summary[0]||{}, p=payout[0]||{}, l=liability[0]||{}, c=carryover[0]||{}, old=legacy[0]||{}, f=funding[0]||{}, m=companyMargin[0]||{}
    return NextResponse.json({ accounting_ready:true, range:{from,to}, summary:{
      eligible_units:n(m.eligible_products_sold),product_order_units:n(s.eligible_units),total_pu:n(s.total_pu),completed_pairs:n(s.completed_pairs),payable_pairs:n(s.payable_pairs),
      earned:n(s.earned),approved:n(p.approved),paid:n(p.paid),payable_liability:n(l.payable_liability),flashout:n(s.flashout),
      cap_flashout_pairs:n(s.cap_flashout_pairs),inactive_flashout_pairs:n(s.inactive_flashout_pairs),average_rate:n(s.average_rate),
      recorded_order_margin:n(s.recorded_gross_margin),company_product_margin:n(m.gross_margin),product_binary_allocation:n(f.allocated_period),
      opening_available_fund:n(f.opening_available),funding_allocated_to_date:n(f.allocated_to_date),available_fund:n(f.available_fund),funded_usage:n(f.funded_usage_period),
      unfunded_usage:n(f.unfunded_period),unfunded_to_date:n(f.unfunded_to_date),
      funding_coverage:n(f.available_fund)-n(l.payable_liability),clean_product_margin:n(m.gross_margin)-n(f.allocated_period),
      margin_after_product_binary:n(m.gross_margin)-n(s.earned),
      total_flashout:n(s.flashout)+n(old.flashout),left_carryover_pu:n(c.left_pu),right_carryover_pu:n(c.right_pu),legacy_earned:n(old.earned),legacy_flashout:n(old.flashout),legacy_events:n(old.events),
    }, ranks, ledger, notes:{
      pu:'PU is product volume, not always bottle quantity. Each product uses its configured PU value.',
      reserve:'Liability uses the exact rank rate when a pair completes. Funding is realized Hiroma product gross margin; available fund and liability remain separate accounting balances.',
      legacy:'Legacy sponsor-point credits are preserved but excluded from exact pair/rank/carryover counts because old rows did not save those snapshots.',
    }})
  } catch (error) {
    console.error('[PRODUCT BINARY REPORT]',error)
    return NextResponse.json({ accounting_ready:false,error:'Product Binary migration is pending.',migration_required:'20260809023000_product_binary_accounting' },{status:503})
  }
}
