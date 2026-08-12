import { NextRequest, NextResponse } from "next/server";
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

    const openingCutoff = new Date(from.getTime() - 1);
    const [
      eventSummary,
      earned,
      flashout,
      approved,
      released,
      openingLiability,
      liability,
      funding,
      openingFunding,
      closingFunding,
      points,
      capRows,
      ledger,
      breakdowns,
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
          AND COALESCE(p.processed_at,c.allocated_at) >= ${from}
          AND COALESCE(p.processed_at,c.allocated_at) <= ${to}
      `,
      prisma.$queryRaw<Amount[]>`
        SELECT COALESCE(SUM(c.amount),0)::float amount
        FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id
        WHERE p.status='released'
          AND COALESCE(p.payout_date,p.processed_at,c.allocated_at) >= ${from}
          AND COALESCE(p.payout_date,p.processed_at,c.allocated_at) <= ${to}
      `,
      prisma.$queryRaw<Amount[]>`
        SELECT GREATEST(
          COALESCE((SELECT SUM(original_amount) FROM binary_payable_lots WHERE allocated_at <= ${openingCutoff}),0)
          - COALESCE((SELECT SUM(c.amount) FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id
              WHERE p.status='released' AND COALESCE(p.payout_date,p.processed_at,c.allocated_at) <= ${openingCutoff}),0), 0
        )::float amount
      `,
      prisma.$queryRaw<Amount[]>`
        SELECT GREATEST(
          COALESCE((SELECT SUM(original_amount) FROM binary_payable_lots WHERE allocated_at <= ${to}),0)
          - COALESCE((SELECT SUM(c.amount) FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id
              WHERE p.status='released' AND COALESCE(p.payout_date,p.processed_at,c.allocated_at) <= ${to}),0), 0
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
               e.inactive_flashout_pairs, e.payable_amount::float, e.flashout_amount::float
        FROM binary_pair_events e
        JOIN users recipient ON recipient.id=e.recipient_user_id
        JOIN users source ON source.id=e.source_user_id
        WHERE e.created_at >= ${from} AND e.created_at <= ${to}
        ORDER BY e.created_at DESC LIMIT 250
      `,
      loadBinaryCommissionBreakdowns(from, to),
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
