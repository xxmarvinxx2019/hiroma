import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/app/lib/auth";
import prisma from "@/app/lib/prisma";
const date = (v: string | null, end: boolean) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? new Date(`${v}T${end ? "23:59:59.999" : "00:00:00.000"}+08:00`)
    : null;
const n = (v: unknown) => Number(v || 0) || 0;
type LedgerRow = {
  id: string;
  date: Date;
  amount: number;
  paid_to_end: number;
  forfeited_to_end: number;
  remaining_to_end: number;
  referrer_name: string;
  referrer_username: string;
  referred_name: string | null;
  referred_username: string | null;
};
type SettlementAuditRow = {
  id: string;
  created_at: Date;
  settlement_day: Date;
  source_event_id: string;
  registration_financial_id: string;
  sponsor_name: string;
  sponsor_username: string;
  referred_name: string;
  referred_username: string;
  outlet_name: string;
  outlet_username: string;
  registration_channel: string;
  package_name: string;
  payment_status: string;
  paid_at: Date | null;
  customer_payment: number;
  product_acquisition_cost: number;
  reseller_value: number;
  pin_allocation: number;
  outlet_registration_profit: number;
  direct_referral_allocation: number;
  binary_commission_allocation: number;
  sponsor_package_name: string;
  sponsor_bonus: number;
  cap_enabled: boolean;
  cap_limit: number;
  opening_daily_count: number;
  closing_daily_count: number;
  recipient_eligible: boolean;
  disposition: string;
  payable_amount: number;
  retained_amount: number;
  normal_commission_id: string | null;
  retained_commission_id: string | null;
};
type ReconciliationSummary = {
  event_count: number;
  source_allocation: number;
  payable_amount: number;
  retained_amount: number;
  mismatch_count: number;
};
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const now = new Date(),
      from =
        date(req.nextUrl.searchParams.get("from"), false) ||
        new Date(now.getFullYear(), now.getMonth(), 1),
      to =
        date(req.nextUrl.searchParams.get("to"), true) ||
        new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    if (from > to)
      return NextResponse.json(
        { error: "From date cannot be later than To date." },
        { status: 400 },
      );
    const [income, paid, approved, reserve, flash, ledger, liabilityLedger, settlementAudit, reconciliation] = await Promise.all([
      prisma.$queryRaw<
        { count: number; amount: number }[]
      >`SELECT COUNT(*)::int count,COALESCE(SUM(original_amount),0)::float amount FROM direct_referral_reserve_lots WHERE allocated_at>=${from} AND allocated_at<=${to}`,
      prisma.$queryRaw<
        { amount: number }[]
      >`SELECT COALESCE(SUM(c.amount),0)::float amount FROM direct_referral_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to} AND p.status='released'`,
      prisma.$queryRaw<
        { amount: number }[]
      >`SELECT COALESCE(SUM(c.amount),0)::float amount FROM direct_referral_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE COALESCE(p.processed_at,p.requested_at)<=${to} AND p.status='approved'`,
      prisma.$queryRaw<
        { amount: number }[]
      >`SELECT COALESCE(SUM(l.original_amount),0)::float-COALESCE((SELECT SUM(c.amount) FROM direct_referral_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to} AND p.status='released'),0)::float-COALESCE((SELECT SUM(f.amount) FROM payable_lot_forfeitures f WHERE f.source_type='direct_referral' AND f.created_at<=${to}),0)::float amount FROM direct_referral_reserve_lots l WHERE l.allocated_at<=${to}`,
      prisma.$queryRaw<
        { count: number; amount: number }[]
      >`SELECT COUNT(*)::int count,COALESCE(SUM(amount),0)::float amount FROM commissions WHERE type='direct_referral' AND is_pair_overflow=true AND created_at>=${from} AND created_at<=${to}`,
      prisma.$queryRaw<
        LedgerRow[]
      >`SELECT l.id::text id,l.allocated_at date,l.original_amount::float amount,COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to} AND p.status='released'),0)::float paid_to_end,COALESCE((SELECT f.amount FROM payable_lot_forfeitures f WHERE f.direct_lot_id=l.id AND f.created_at<=${to}),0)::float forfeited_to_end,GREATEST(l.original_amount-COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to} AND p.status='released'),0)-COALESCE((SELECT f.amount FROM payable_lot_forfeitures f WHERE f.direct_lot_id=l.id AND f.created_at<=${to}),0),0)::float remaining_to_end,r.full_name referrer_name,r.username referrer_username,m.full_name referred_name,m.username referred_username FROM direct_referral_reserve_lots l JOIN commissions x ON x.id=l.commission_id JOIN users r ON r.id=l.user_id LEFT JOIN users m ON m.id=x.source_user_id LEFT JOIN direct_referral_payout_consumptions c ON c.reserve_lot_id=l.id LEFT JOIN payouts p ON p.id=c.payout_id WHERE l.allocated_at>=${from} AND l.allocated_at<=${to} GROUP BY l.id,l.allocated_at,l.original_amount,r.full_name,r.username,m.full_name,m.username ORDER BY l.allocated_at DESC LIMIT 250`,
      prisma.$queryRaw<LedgerRow[]>`
        SELECT l.id::text id,l.allocated_at date,l.original_amount::float amount,
               COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to} AND p.status='released'),0)::float paid_to_end,
               COALESCE((SELECT f.amount FROM payable_lot_forfeitures f WHERE f.direct_lot_id=l.id AND f.created_at<=${to}),0)::float forfeited_to_end,
               GREATEST(l.original_amount-COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to} AND p.status='released'),0)-COALESCE((SELECT f.amount FROM payable_lot_forfeitures f WHERE f.direct_lot_id=l.id AND f.created_at<=${to}),0),0)::float remaining_to_end,
               r.full_name referrer_name,r.username referrer_username,m.full_name referred_name,m.username referred_username
        FROM direct_referral_reserve_lots l
        JOIN commissions x ON x.id=l.commission_id
        JOIN users r ON r.id=l.user_id
        LEFT JOIN users m ON m.id=x.source_user_id
        LEFT JOIN direct_referral_payout_consumptions c ON c.reserve_lot_id=l.id
        LEFT JOIN payouts p ON p.id=c.payout_id
        WHERE l.allocated_at<=${to}
        GROUP BY l.id,l.allocated_at,l.original_amount,r.full_name,r.username,m.full_name,m.username
        HAVING GREATEST(l.original_amount-COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to} AND p.status='released'),0)-COALESCE((SELECT f.amount FROM payable_lot_forfeitures f WHERE f.direct_lot_id=l.id AND f.created_at<=${to}),0),0)>0
        ORDER BY l.allocated_at ASC,l.id ASC LIMIT 500
      `,
      prisma.$queryRaw<SettlementAuditRow[]>`
        SELECT event.id::text,
               event.created_at,
               event.settlement_day,
               event.source_event_id,
               event.registration_financial_id::text,
               sponsor.full_name AS sponsor_name,
               sponsor.username AS sponsor_username,
               referred.full_name AS referred_name,
               referred.username AS referred_username,
               outlet.full_name AS outlet_name,
               outlet.username AS outlet_username,
               financial.registration_channel,
               financial.package_name_snapshot AS package_name,
               financial.payment_status,
               financial.paid_at,
               financial.customer_payment::float,
               financial.product_acquisition_cost::float,
               financial.reseller_value::float,
               financial.pin_allocation::float,
               financial.registration_profit::float AS outlet_registration_profit,
               financial.direct_referral_allocation::float,
               financial.binary_commission_allocation::float,
               event.package_name_snapshot AS sponsor_package_name,
               event.sponsor_bonus_snapshot::float AS sponsor_bonus,
               event.cap_enabled,
               event.cap_limit,
               event.opening_daily_referral_count AS opening_daily_count,
               event.closing_daily_referral_count AS closing_daily_count,
               event.recipient_eligible,
               event.disposition,
               event.payable_amount::float,
               event.retained_amount::float,
               event.normal_commission_id,
               event.retained_commission_id
        FROM direct_referral_settlement_events event
        JOIN registration_financials financial ON financial.id=event.registration_financial_id
        JOIN users sponsor ON sponsor.id=event.sponsor_user_id
        JOIN users referred ON referred.id=event.referred_user_id
        JOIN users outlet ON outlet.id=financial.city_dist_id
        WHERE event.created_at>=${from} AND event.created_at<=${to}
        ORDER BY event.created_at DESC, event.id DESC
        LIMIT 500
      `,
      prisma.$queryRaw<ReconciliationSummary[]>`
        SELECT COUNT(*)::int AS event_count,
               COALESCE(SUM(source_allocation),0)::float AS source_allocation,
               COALESCE(SUM(payable_amount),0)::float AS payable_amount,
               COALESCE(SUM(retained_amount),0)::float AS retained_amount,
               COUNT(*) FILTER(WHERE source_allocation<>payable_amount+retained_amount)::int AS mismatch_count
        FROM direct_referral_settlement_events
        WHERE created_at>=${from} AND created_at<=${to}
      `,
    ]);
    return NextResponse.json({
      summary: {
        total_direct_referrals: n(income[0]?.count),
        total_direct_referral_income: n(income[0]?.amount),
        total_paid: n(paid[0]?.amount),
        total_approved: n(approved[0]?.amount),
        total_reserve_liability: Math.max(0, n(reserve[0]?.amount)),
        total_flashout: n(flash[0]?.amount),
        flashout_events: n(flash[0]?.count),
      },
      ledger,
      liability_ledger: liabilityLedger,
      settlement_audit: settlementAudit,
      reconciliation: reconciliation[0] || {
        event_count: 0,
        source_allocation: 0,
        payable_amount: 0,
        retained_amount: 0,
        mismatch_count: 0,
      },
      data_notes: {
        total_paid:
          "Direct-referral earnings actually released in the selected period.",
        total_approved:
          "Approved direct-referral earnings still awaiting release as of the selected end date.",
        total_reserve_liability:
          "Total referral earnings created through this date, less amounts released or lawfully forfeited. Approved payouts remain included until release.",
        historical: "Historical payouts use direct-referral-first FIFO.",
        flashout: "Direct-referral overflow retained by Hiroma.",
      },
    });
  } catch (error) {
    console.error("[DIRECT REFERRAL]", error);
    return NextResponse.json(
      { error: "Unable to load direct referral data." },
      { status: 500 },
    );
  }
}
