import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/app/lib/auth";
import prisma from "@/app/lib/prisma";
import { calculateBinaryFundingPosition } from "@/app/lib/binaryAccounting";
import {
  loadBinaryFundingMovement,
  loadBinaryFundingPosition,
} from "@/app/lib/binaryAccountingReport";
import { loadBinaryCommissionBreakdowns } from "@/app/lib/binaryCommissionBreakdowns";

const parseDate = (value: string | null, end: boolean) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+08:00`)
    : null;
const number = (value: unknown) => Number(value || 0) || 0;

type Amount = { amount: number };
type EventSummary = {
  completed_pairs: number;
  payable_pairs: number;
  cap_flashout_pairs: number;
  inactive_flashout_pairs: number;
  members_reached_cap: number;
};
type LegacyFunding = {
  allocated: number;
  available: number;
  funded_usage: number;
  unfunded_usage: number;
};
type Points = {
  left_points: number;
  right_points: number;
  matched_points: number;
};
type CapRow = {
  package_name: string;
  completed_pairs: number;
  payable_pairs: number;
  flashout_pairs: number;
  flashout_amount: number;
  members_reached_cap: number;
};
type LedgerRow = {
  id: string;
  created_at: Date;
  recipient_name: string;
  recipient_username: string;
  package_name: string;
  source_name: string;
  source_username: string;
  source_kind: string;
  source_leg: string;
  source_points: number;
  points_per_pair: number;
  completed_pairs: number;
  payable_pairs: number;
  cap_flashout_pairs: number;
  inactive_flashout_pairs: number;
  payable_amount: number;
  flashout_amount: number;
  pair_value: number;
  peso_per_point: number;
  opening_left_points: number | null;
  opening_right_points: number | null;
  closing_left_points: number | null;
  closing_right_points: number | null;
  consumed_left_points: number;
  consumed_right_points: number;
  pairing_day: Date | null;
  opening_daily_count: number | null;
  closing_daily_count: number | null;
  cap_enabled: boolean;
  cap_limit: number | null;
  package_snapshot_source: string;
  source_event_id: string | null;
  normal_commission_id: string | null;
  flashout_commission_id: string | null;
  funded_amount: number;
  unfunded_amount: number;
  wallet_ledger_id: string | null;
  approved_amount: number;
  released_amount: number;
  payout_references: string | null;
  source_financial_id: string | null;
  source_package: string | null;
  source_channel: string | null;
  source_payment_status: string | null;
  source_paid_at: Date | null;
  source_outlet_name: string | null;
  source_outlet_username: string | null;
  source_customer_payment: number;
  source_product_cost: number;
  source_direct_allocation: number;
  source_binary_allocation: number;
};
type LiabilityRow = {
  id: string; allocated_at: Date; recipient_name: string; recipient_username: string;
  package_name: string; original_amount: number; released_amount: number;
  forfeited_amount: number; remaining_amount: number; commission_id: string; age_days: number;
};
type ReconciliationRow = {
  event_count: number; pair_mismatch_count: number; money_mismatch_count: number;
  completed_pairs: number; classified_pairs: number; expected_value: number; classified_value: number;
};

async function legacyBinaryReport(req: NextRequest) {
  const now = new Date();
  const from =
    parseDate(req.nextUrl.searchParams.get("from"), false) ||
    new Date(now.getFullYear(), now.getMonth(), 1);
  const to =
    parseDate(req.nextUrl.searchParams.get("to"), true) ||
    new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [pairs, earned, flashout, funding, points] = await Promise.all([
    prisma.$queryRaw<{ completed_pairs: number }[]>`
      SELECT COALESCE(SUM(pairs_created),0)::int completed_pairs
      FROM pairing_logs WHERE date_created >= ${from} AND date_created <= ${to}
    `,
    prisma.$queryRaw<Amount[]>`
      SELECT COALESCE(SUM(amount),0)::float amount FROM commissions
      WHERE type='binary_pairing' AND is_pair_overflow=false
        AND created_at >= ${from} AND created_at <= ${to}
    `,
    prisma.$queryRaw<Amount[]>`
      SELECT COALESCE(SUM(amount),0)::float amount FROM commissions
      WHERE type='binary_pairing' AND is_pair_overflow=true
        AND created_at >= ${from} AND created_at <= ${to}
    `,
    prisma.$queryRaw<LegacyFunding[]>`
      SELECT
        COALESCE((SELECT SUM(original_amount) FROM binary_reserve_lots WHERE allocated_at >= ${from} AND allocated_at <= ${to}),0)::float allocated,
        COALESCE((SELECT SUM(remaining_amount) FROM binary_reserve_lots),0)::float available,
        COALESCE((SELECT SUM(amount) FROM binary_reserve_consumptions WHERE is_unfunded=false AND consumed_at >= ${from} AND consumed_at <= ${to}),0)::float funded_usage,
        COALESCE((SELECT SUM(amount) FROM binary_reserve_consumptions WHERE is_unfunded=true AND consumed_at >= ${from} AND consumed_at <= ${to}),0)::float unfunded_usage
    `,
    prisma.$queryRaw<Points[]>`
      SELECT COALESCE(SUM(left_points),0)::float left_points,
             COALESCE(SUM(right_points),0)::float right_points,
             COALESCE(SUM(LEAST(left_points,right_points)),0)::float matched_points
      FROM reseller_profiles
    `,
  ]);

  return NextResponse.json({
    accounting_ready: false,
    migration_required: "20260808223000_binary_commission_audit_accounting",
    warning:
      "Legacy read-only totals are shown. Apply the Binary Commission audit migration to activate exact pair, payout, liability, and cap accounting.",
    summary: {
      completed_pairs: number(pairs[0]?.completed_pairs),
      payable_pairs: 0,
      total_binary_income: number(earned[0]?.amount),
      total_approved: 0,
      total_paid: 0,
      total_forfeited: 0,
      opening_payable_liability: 0,
      payable_liability: 0,
      total_flashout: number(flashout[0]?.amount),
      cap_flashout_pairs: 0,
      inactive_flashout_pairs: 0,
      members_reached_cap: 0,
      funding_allocated: number(funding[0]?.allocated),
      funding_opening_held: 0,
      funding_earmarked: number(funding[0]?.funded_usage),
      funding_uncommitted: number(funding[0]?.available),
      funding_total_held:
        number(funding[0]?.available) + number(funding[0]?.funded_usage),
      funding_earned_earmarked: number(funding[0]?.funded_usage),
      funding_released: 0,
      funding_flashout_reclassified: 0,
      funding_shortfall_created: number(funding[0]?.unfunded_usage),
      funding_shortfall: 0,
      funding_surplus: 0,
      funding_coverage_ratio: 0,
    },
    points: {
      left: number(points[0]?.left_points),
      right: number(points[0]?.right_points),
      matched_waiting: number(points[0]?.matched_points),
    },
    cap_rows: [],
    ledger: [],
    ledger_page: { page: 1, page_size: 100, total: 0, total_pages: 1 },
    liability_ledger: [],
    reconciliation: {
      event_count: 0, pair_mismatch_count: 0, money_mismatch_count: 0,
      completed_pairs: 0, classified_pairs: 0, expected_value: 0, classified_value: 0,
    },
    breakdowns: {
      pairs: [], earned: [], approved: [], paid: [], liability: [],
      flashout: [], reserve_allocated: [], reserve_movement: [],
    },
    notes: {
      liability: "Migration pending; exact liability is intentionally hidden.",
      funding: "Existing company funding-pool balance.",
      payout_policy:
        "Migration pending; binary payout attribution is intentionally hidden.",
      flashout: "Existing binary overflow commission total.",
      history: "Apply the audit migration to enable exact accounting details.",
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const now = new Date();
    const from =
      parseDate(req.nextUrl.searchParams.get("from"), false) ||
      new Date(now.getFullYear(), now.getMonth(), 1);
    const to =
      parseDate(req.nextUrl.searchParams.get("to"), true) ||
      new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    if (from > to)
      return NextResponse.json(
        { error: "From date cannot be later than To date." },
        { status: 400 },
      );

    const requestedPage = Number(req.nextUrl.searchParams.get("page") || 1);
    const requestedPageSize = Number(req.nextUrl.searchParams.get("page_size") || 100);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = Number.isInteger(requestedPageSize)
      ? Math.min(Math.max(requestedPageSize, 1), 500)
      : 100;
    const search = (req.nextUrl.searchParams.get("search") || "").trim().slice(0, 120);
    const requestedEventFilter = req.nextUrl.searchParams.get("event_filter") || "all";
    const eventFilter = ["all", "payable", "cap", "inactive", "no_pair"].includes(requestedEventFilter)
      ? requestedEventFilter
      : "all";
    const searchPattern = `%${search}%`;
    const ledgerFilter = Prisma.sql`
      e.created_at >= ${from} AND e.created_at <= ${to}
      ${search ? Prisma.sql`AND (recipient.full_name ILIKE ${searchPattern} OR recipient.username ILIKE ${searchPattern} OR source.full_name ILIKE ${searchPattern} OR source.username ILIKE ${searchPattern} OR e.package_name_snapshot ILIKE ${searchPattern} OR e.source_kind ILIKE ${searchPattern} OR COALESCE(e.source_event_id,'') ILIKE ${searchPattern} OR COALESCE(e.normal_commission_id,'') ILIKE ${searchPattern} OR COALESCE(e.flashout_commission_id,'') ILIKE ${searchPattern} OR COALESCE(rf.id::text,uf.id::text,'') ILIKE ${searchPattern} OR COALESCE(rf.package_name_snapshot,uf.to_package_name_snapshot,'') ILIKE ${searchPattern} OR COALESCE(outlet.full_name,'') ILIKE ${searchPattern} OR COALESCE(outlet.username,'') ILIKE ${searchPattern})` : Prisma.empty}
      ${eventFilter === "payable" ? Prisma.sql`AND e.payable_pairs > 0` : eventFilter === "cap" ? Prisma.sql`AND e.cap_flashout_pairs > 0` : eventFilter === "inactive" ? Prisma.sql`AND e.inactive_flashout_pairs > 0` : eventFilter === "no_pair" ? Prisma.sql`AND e.completed_pairs = 0` : Prisma.empty}
    `;

    const openingCutoff = new Date(from.getTime() - 1);
    const [
      eventSummary,
      earned,
      flashout,
      approved,
      released,
      forfeited,
      openingLiability,
      liability,
      funding,
      openingFunding,
      closingFunding,
      points,
      capRows,
      ledger,
      ledgerCount,
      breakdowns,
      liabilityLedger,
      reconciliation,
    ] = await Promise.all([
      prisma.$queryRaw<EventSummary[]>`
        SELECT COALESCE(SUM(completed_pairs),0)::int completed_pairs,
               COALESCE(SUM(payable_pairs),0)::int payable_pairs,
               COALESCE(SUM(cap_flashout_pairs),0)::int cap_flashout_pairs,
               COALESCE(SUM(inactive_flashout_pairs),0)::int inactive_flashout_pairs,
               COUNT(DISTINCT recipient_user_id) FILTER (WHERE cap_flashout_pairs > 0)::int members_reached_cap
        FROM binary_pair_events WHERE created_at >= ${from} AND created_at <= ${to}
      `,
      prisma.$queryRaw<Amount[]>`
        SELECT COALESCE(SUM(amount),0)::float amount FROM commissions
        WHERE type='binary_pairing' AND is_pair_overflow=false
          AND created_at >= ${from} AND created_at <= ${to}
      `,
      prisma.$queryRaw<Amount[]>`
        SELECT COALESCE(SUM(amount),0)::float amount FROM commissions
        WHERE type='binary_pairing' AND is_pair_overflow=true
          AND created_at >= ${from} AND created_at <= ${to}
      `,
      prisma.$queryRaw<Amount[]>`
        SELECT COALESCE(SUM(c.amount),0)::float amount
        FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id
        WHERE p.status='approved'
          AND COALESCE(p.processed_at,p.requested_at) <= ${to}
      `,
      prisma.$queryRaw<Amount[]>`
        SELECT COALESCE(SUM(c.amount),0)::float amount
        FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id
        WHERE p.status='released'
          AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) >= ${from}
          AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) <= ${to}
      `,
      prisma.$queryRaw<Amount[]>`
        SELECT COALESCE(SUM(amount),0)::float amount FROM payable_lot_forfeitures
        WHERE source_type='binary' AND created_at>=${from} AND created_at<=${to}
      `,
      prisma.$queryRaw<Amount[]>`
        SELECT GREATEST(
          COALESCE((SELECT SUM(original_amount) FROM binary_payable_lots WHERE allocated_at <= ${openingCutoff}),0)
          - COALESCE((SELECT SUM(c.amount) FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id
              WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) <= ${openingCutoff}),0)
          - COALESCE((SELECT SUM(f.amount) FROM payable_lot_forfeitures f WHERE f.source_type='binary' AND f.created_at <= ${openingCutoff}),0), 0
        )::float amount
      `,
      prisma.$queryRaw<Amount[]>`
        SELECT GREATEST(
          COALESCE((SELECT SUM(original_amount) FROM binary_payable_lots WHERE allocated_at <= ${to}),0)
          - COALESCE((SELECT SUM(c.amount) FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id
              WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) <= ${to}),0)
          - COALESCE((SELECT SUM(f.amount) FROM payable_lot_forfeitures f WHERE f.source_type='binary' AND f.created_at <= ${to}),0), 0
        )::float amount
      `,
      loadBinaryFundingMovement(from, to),
      loadBinaryFundingPosition(openingCutoff),
      loadBinaryFundingPosition(to),
      prisma.$queryRaw<Points[]>`
        SELECT COALESCE(SUM(left_points),0)::float left_points,
               COALESCE(SUM(right_points),0)::float right_points,
               COALESCE(SUM(LEAST(left_points,right_points)),0)::float matched_points
        FROM reseller_profiles
      `,
      prisma.$queryRaw<CapRow[]>`
        SELECT e.package_name_snapshot package_name,
               SUM(e.completed_pairs)::int completed_pairs,
               SUM(e.payable_pairs)::int payable_pairs,
               SUM(e.cap_flashout_pairs + e.inactive_flashout_pairs)::int flashout_pairs,
               SUM(e.flashout_amount)::float flashout_amount,
               COUNT(DISTINCT e.recipient_user_id) FILTER (WHERE e.cap_flashout_pairs > 0)::int members_reached_cap
        FROM binary_pair_events e
        WHERE e.created_at >= ${from} AND e.created_at <= ${to}
        GROUP BY e.package_name_snapshot ORDER BY e.package_name_snapshot
      `,
      prisma.$queryRaw<LedgerRow[]>`
        SELECT e.id::text, e.created_at,
               recipient.full_name recipient_name, recipient.username recipient_username,
               e.package_name_snapshot package_name,
               source.full_name source_name, source.username source_username,
               e.source_kind, e.source_leg, e.source_points, e.points_per_pair,
               e.completed_pairs, e.payable_pairs, e.cap_flashout_pairs,
               e.inactive_flashout_pairs, e.payable_amount::float, e.flashout_amount::float,
               e.pair_value_snapshot::float pair_value,e.peso_per_point::float,
               e.opening_left_points,e.opening_right_points,e.closing_left_points,e.closing_right_points,
               e.consumed_left_points,e.consumed_right_points,e.pairing_day,
               e.opening_daily_pairing_count opening_daily_count,e.closing_daily_pairing_count closing_daily_count,
               e.cap_enabled,e.cap_limit,e.package_snapshot_source,e.source_event_id,
               e.normal_commission_id,e.flashout_commission_id,
               COALESCE((SELECT SUM(rc.amount) FROM binary_reserve_consumptions rc WHERE rc.commission_id=e.normal_commission_id AND rc.is_unfunded=false),0)::float funded_amount,
               COALESCE((SELECT SUM(rc.amount) FROM binary_reserve_consumptions rc WHERE rc.commission_id=e.normal_commission_id AND rc.is_unfunded=true),0)::float unfunded_amount,
               (SELECT w.id::text FROM wallet_ledger_entries w WHERE w.commission_id=e.normal_commission_id LIMIT 1) wallet_ledger_id,
               COALESCE((SELECT SUM(pc.amount) FROM binary_payable_lots lot JOIN binary_payout_consumptions pc ON pc.payable_lot_id=lot.id JOIN payouts p ON p.id=pc.payout_id WHERE lot.commission_id=e.normal_commission_id AND p.status='approved' AND COALESCE(p.processed_at,p.requested_at)<=${to}),0)::float approved_amount,
               COALESCE((SELECT SUM(pc.amount) FROM binary_payable_lots lot JOIN binary_payout_consumptions pc ON pc.payable_lot_id=lot.id JOIN payouts p ON p.id=pc.payout_id WHERE lot.commission_id=e.normal_commission_id AND p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0)::float released_amount,
               (SELECT STRING_AGG(DISTINCT COALESCE(p.transaction_number,p.batch_id,p.id),', ') FROM binary_payable_lots lot JOIN binary_payout_consumptions pc ON pc.payable_lot_id=lot.id JOIN payouts p ON p.id=pc.payout_id WHERE lot.commission_id=e.normal_commission_id) payout_references
               ,COALESCE(rf.id,uf.id)::text source_financial_id,
               COALESCE(rf.package_name_snapshot,uf.to_package_name_snapshot) source_package,
               CASE WHEN rf.id IS NOT NULL THEN rf.registration_channel WHEN uf.id IS NOT NULL THEN 'upgrade' ELSE NULL END source_channel,
               COALESCE(rf.payment_status,uf.payment_status) source_payment_status,
               COALESCE(rf.paid_at,uf.paid_at) source_paid_at,
               outlet.full_name source_outlet_name,outlet.username source_outlet_username,
               COALESCE(rf.customer_payment,uf.customer_payment,0)::float source_customer_payment,
               COALESCE(rf.product_acquisition_cost,uf.product_acquisition_cost,0)::float source_product_cost,
               COALESCE(rf.direct_referral_allocation,uf.direct_referral_allocation,0)::float source_direct_allocation,
               COALESCE(rf.binary_commission_allocation,uf.binary_commission_allocation,0)::float source_binary_allocation
        FROM binary_pair_events e
        JOIN users recipient ON recipient.id=e.recipient_user_id
        JOIN users source ON source.id=e.source_user_id
        LEFT JOIN registration_financials rf ON e.source_kind='registration' AND rf.pin_id=e.source_event_id
        LEFT JOIN upgrade_financials uf ON e.source_kind='upgrade' AND uf.upgrade_pin_id::text=e.source_event_id
        LEFT JOIN users outlet ON outlet.id=COALESCE(rf.city_dist_id,uf.city_dist_id)
        WHERE ${ledgerFilter}
        ORDER BY e.created_at DESC,e.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `,
      prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int count FROM binary_pair_events e
        JOIN users recipient ON recipient.id=e.recipient_user_id
        JOIN users source ON source.id=e.source_user_id
        LEFT JOIN registration_financials rf ON e.source_kind='registration' AND rf.pin_id=e.source_event_id
        LEFT JOIN upgrade_financials uf ON e.source_kind='upgrade' AND uf.upgrade_pin_id::text=e.source_event_id
        LEFT JOIN users outlet ON outlet.id=COALESCE(rf.city_dist_id,uf.city_dist_id)
        WHERE ${ledgerFilter}
      `,
      loadBinaryCommissionBreakdowns(from, to),
      prisma.$queryRaw<LiabilityRow[]>`
        SELECT lot.id::text,lot.allocated_at,u.full_name recipient_name,u.username recipient_username,
               COALESCE(e.package_name_snapshot,p.name,'Legacy / Unknown') package_name,
               lot.original_amount::float,
               COALESCE((SELECT SUM(pc.amount) FROM binary_payout_consumptions pc JOIN payouts py ON py.id=pc.payout_id WHERE pc.payable_lot_id=lot.id AND py.status='released' AND COALESCE(py.released_at,py.payout_date,py.processed_at,py.requested_at)<=${to}),0)::float released_amount,
               COALESCE((SELECT f.amount FROM payable_lot_forfeitures f WHERE f.binary_lot_id=lot.id AND f.created_at<=${to}),0)::float forfeited_amount,
               GREATEST(lot.original_amount-COALESCE((SELECT SUM(pc.amount) FROM binary_payout_consumptions pc JOIN payouts py ON py.id=pc.payout_id WHERE pc.payable_lot_id=lot.id AND py.status='released' AND COALESCE(py.released_at,py.payout_date,py.processed_at,py.requested_at)<=${to}),0)-COALESCE((SELECT f.amount FROM payable_lot_forfeitures f WHERE f.binary_lot_id=lot.id AND f.created_at<=${to}),0),0)::float remaining_amount,
               lot.commission_id,
               GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (${to}-lot.allocated_at))/86400))::int age_days
        FROM binary_payable_lots lot JOIN users u ON u.id=lot.user_id
        JOIN commissions c ON c.id=lot.commission_id LEFT JOIN binary_pair_events e ON e.normal_commission_id=c.id
        LEFT JOIN reseller_profiles r ON r.user_id=lot.user_id LEFT JOIN packages p ON p.id=r.package_id
        WHERE lot.allocated_at<=${to}
          AND GREATEST(lot.original_amount-COALESCE((SELECT SUM(pc.amount) FROM binary_payout_consumptions pc JOIN payouts py ON py.id=pc.payout_id WHERE pc.payable_lot_id=lot.id AND py.status='released' AND COALESCE(py.released_at,py.payout_date,py.processed_at,py.requested_at)<=${to}),0)-COALESCE((SELECT f.amount FROM payable_lot_forfeitures f WHERE f.binary_lot_id=lot.id AND f.created_at<=${to}),0),0)>0
        ORDER BY lot.allocated_at ASC,lot.id ASC LIMIT 500
      `,
      prisma.$queryRaw<ReconciliationRow[]>`
        SELECT COUNT(*)::int event_count,
               COUNT(*) FILTER(WHERE completed_pairs<>payable_pairs+cap_flashout_pairs+inactive_flashout_pairs)::int pair_mismatch_count,
               COUNT(*) FILTER(WHERE ABS((completed_pairs*pair_value_snapshot)-(payable_amount+flashout_amount))>0.005)::int money_mismatch_count,
               COALESCE(SUM(completed_pairs),0)::int completed_pairs,
               COALESCE(SUM(payable_pairs+cap_flashout_pairs+inactive_flashout_pairs),0)::int classified_pairs,
               COALESCE(SUM(completed_pairs*pair_value_snapshot),0)::float expected_value,
               COALESCE(SUM(payable_amount+flashout_amount),0)::float classified_value
        FROM binary_pair_events WHERE created_at>=${from} AND created_at<=${to}
      `,
    ]);

    const payableLiability = Math.max(0, number(liability[0]?.amount));
    const fundingPosition = calculateBinaryFundingPosition({
      payableLiability,
      uncommittedReserve: closingFunding.uncommitted,
      earmarkedReserve: closingFunding.earmarked,
    });
    const reportedPairs = breakdowns.pairs.reduce(
      (total, row) => total + Number(row.quantity || 0),
      0,
    );
    const reportedPayablePairs = breakdowns.earned.reduce(
      (total, row) => total + Number(row.quantity || 0),
      0,
    );
    return NextResponse.json({
      accounting_ready: true,
      migration_required: null,
      warning: null,
      summary: {
        completed_pairs: reportedPairs,
        payable_pairs: reportedPayablePairs,
        total_binary_income: number(earned[0]?.amount),
        total_approved: number(approved[0]?.amount),
        total_paid: number(released[0]?.amount),
        total_forfeited: number(forfeited[0]?.amount),
        opening_payable_liability: number(openingLiability[0]?.amount),
        payable_liability: payableLiability,
        total_flashout: number(flashout[0]?.amount),
        cap_flashout_pairs: number(eventSummary[0]?.cap_flashout_pairs),
        inactive_flashout_pairs: number(
          eventSummary[0]?.inactive_flashout_pairs,
        ),
        members_reached_cap: number(eventSummary[0]?.members_reached_cap),
        funding_allocated: funding.allocated,
        funding_opening_held:
          openingFunding.uncommitted + openingFunding.earmarked,
        funding_earmarked: fundingPosition.earmarkedReserve,
        funding_uncommitted: fundingPosition.uncommittedReserve,
        funding_total_held: fundingPosition.totalReserveHeld,
        funding_earned_earmarked: funding.funded_earnings,
        funding_released: funding.released_from_reserve,
        funding_flashout_reclassified: funding.flashout_reclassified,
        funding_shortfall_created: funding.unfunded_earnings,
        funding_shortfall: fundingPosition.fundingShortfall,
        funding_surplus: fundingPosition.fundingSurplus,
        funding_coverage_ratio: fundingPosition.coverageRatio,
      },
      points: {
        left: number(points[0]?.left_points),
        right: number(points[0]?.right_points),
        matched_waiting: number(points[0]?.matched_points),
      },
      cap_rows: capRows,
      ledger,
      ledger_page: {
        page,
        page_size: pageSize,
        total: number(ledgerCount[0]?.count),
        total_pages: Math.max(1, Math.ceil(number(ledgerCount[0]?.count) / pageSize)),
      },
      liability_ledger: liabilityLedger,
      reconciliation: reconciliation[0],
      breakdowns,
      notes: {
        liability:
          "Normal binary income earned but not yet released. Approved amounts remain a liability until release.",
        funding:
          "Total reserve held is earmarked unpaid reserve plus uncommitted reserve. It excludes flashout already retained by Hiroma and released payouts.",
        payout_policy:
          "Wallet payouts are attributed direct-referral-first, then binary, using FIFO per member.",
        flashout:
          "Only registration-binary cap excess and inactive-account binary earnings retained by Hiroma.",
        history:
          "Exact pair/cap events begin after the binary audit migration; financial totals include reconstructed historical commissions and payouts.",
      },
    });
  } catch (error) {
    console.error("[BINARY COMMISSION REPORT]", error);
    try {
      return await legacyBinaryReport(req);
    } catch (fallbackError) {
      console.error("[BINARY COMMISSION LEGACY REPORT]", fallbackError);
      return NextResponse.json(
        { error: "Unable to load binary commission data." },
        { status: 500 },
      );
    }
  }
}
