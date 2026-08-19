import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/app/lib/auth";
import prisma from "@/app/lib/prisma";

const parseDate = (value: string | null, end = false) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+08:00`)
    : null;
const number = (value: unknown) => Number(value || 0) || 0;
const allowedCategories = new Set(["all", "direct_referral", "binary", "product_binary", "deactivation"]);
const allowedQuality = new Set(["all", "exact", "legacy"]);

type SummaryRow = {
  total_events: number;
  total_amount: number;
  affected_accounts: number;
  recorded_points: number;
  exact_binary_pairs: number;
  exact_events: number;
  legacy_events: number;
};
type BreakdownRow = { key: string; label: string; events: number; amount: number; points: number };
type TrendRow = { day: Date; events: number; amount: number };
type LedgerRow = {
  id: string; created_at: Date; category: string; reason: string; data_quality: string;
  amount: number; recorded_points: number; exact_pairs: number; member_name: string | null;
  member_username: string | null; package_name: string | null; package_source: string;
  recipient_name: string | null; recipient_username: string | null; source_name: string | null;
  source_username: string | null; total_count: number;
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const from = parseDate(req.nextUrl.searchParams.get("from")) || new Date(now.getFullYear(), now.getMonth(), 1);
  const to = parseDate(req.nextUrl.searchParams.get("to"), true) || now;
  if (from > to) return NextResponse.json({ error: "From date cannot be later than To date." }, { status: 400 });

  const requestedCategory = req.nextUrl.searchParams.get("category") || "all";
  const requestedQuality = req.nextUrl.searchParams.get("quality") || "all";
  const category = allowedCategories.has(requestedCategory) ? requestedCategory : "all";
  const quality = allowedQuality.has(requestedQuality) ? requestedQuality : "all";
  const search = (req.nextUrl.searchParams.get("search") || "").trim().toLowerCase().slice(0, 100);
  const requestedPage = Number.parseInt(req.nextUrl.searchParams.get("page") || "1", 10);
  const requestedPageSize = Number.parseInt(req.nextUrl.searchParams.get("page_size") || "50", 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Number.isSafeInteger(requestedPageSize) ? Math.min(Math.max(requestedPageSize, 1), 100) : 50;
  const offset = (page - 1) * pageSize;

  try {
    const [tableCheck] = await prisma.$queryRaw<{ available: boolean }[]>`
      SELECT (to_regclass('public.binary_pair_events') IS NOT NULL) available
    `;
    const exactAccountingAvailable = Boolean(tableCheck?.available);

    // This report deliberately uses commissions as the financial source of truth.
    // Exact binary event snapshots enrich newer rows but never replace the retained amount.
    const [summaryRows, categoryRows, reasonRows, trendRows, ledgerRows] = await Promise.all([
      prisma.$queryRaw<SummaryRow[]>`
        WITH classified AS (
          SELECT c.id,c.created_at,c.amount::float amount,COALESCE(c.points,0)::int recorded_points,
            COALESCE(e.cap_flashout_pairs+e.inactive_flashout_pairs,0)::int exact_pairs,
            COALESCE(e.recipient_user_id,c.source_user_id) affected_user_id,
            CASE WHEN c.type='direct_referral' THEN 'direct_referral'
                 WHEN c.type='sponsor_point' THEN 'product_binary'
                 WHEN c.type='binary_pairing' AND COALESCE(c.points,0)=0 THEN 'deactivation'
                 ELSE 'binary' END category,
            CASE WHEN e.id IS NOT NULL THEN 'exact' ELSE 'legacy' END data_quality
          FROM commissions c LEFT JOIN binary_pair_events e ON e.flashout_commission_id=c.id
          WHERE c.is_pair_overflow=true AND c.created_at>=${from} AND c.created_at<=${to}
        ) SELECT COUNT(*)::int total_events,COALESCE(SUM(amount),0)::float total_amount,
          COUNT(DISTINCT affected_user_id)::int affected_accounts,
          COALESCE(SUM(recorded_points),0)::float recorded_points,
          COALESCE(SUM(exact_pairs),0)::int exact_binary_pairs,
          COUNT(*) FILTER(WHERE data_quality='exact')::int exact_events,
          COUNT(*) FILTER(WHERE data_quality='legacy')::int legacy_events
        FROM classified
      `,
      prisma.$queryRaw<BreakdownRow[]>`
        WITH classified AS (
          SELECT c.amount::float amount,COALESCE(c.points,0)::float points,
            CASE WHEN c.type='direct_referral' THEN 'direct_referral'
                 WHEN c.type='sponsor_point' THEN 'product_binary'
                 WHEN c.type='binary_pairing' AND COALESCE(c.points,0)=0 THEN 'deactivation'
                 ELSE 'binary' END key
          FROM commissions c WHERE c.is_pair_overflow=true AND c.created_at>=${from} AND c.created_at<=${to}
        ) SELECT key,CASE key WHEN 'direct_referral' THEN 'Direct referral overflow'
            WHEN 'binary' THEN 'Binary pairing overflow' WHEN 'product_binary' THEN 'Product binary overflow'
            ELSE 'Deactivation wallet flush' END label,
          COUNT(*)::int events,COALESCE(SUM(amount),0)::float amount,COALESCE(SUM(points),0)::float points
        FROM classified GROUP BY key ORDER BY amount DESC
      `,
      prisma.$queryRaw<BreakdownRow[]>`
        WITH classified AS (
          SELECT c.amount::float amount,COALESCE(c.points,0)::float points,
            CASE WHEN e.cap_flashout_pairs>0 AND e.inactive_flashout_pairs>0 THEN 'mixed_binary'
                 WHEN e.cap_flashout_pairs>0 THEN 'binary_cap'
                 WHEN e.inactive_flashout_pairs>0 THEN 'inactive_binary'
                 WHEN c.type='binary_pairing' AND COALESCE(c.points,0)=0 THEN 'deactivation_wallet'
                 WHEN c.type='direct_referral' THEN 'direct_legacy'
                 WHEN c.type='sponsor_point' THEN 'product_legacy'
                 ELSE 'binary_legacy' END key
          FROM commissions c LEFT JOIN binary_pair_events e ON e.flashout_commission_id=c.id
          WHERE c.is_pair_overflow=true AND c.created_at>=${from} AND c.created_at<=${to}
        ) SELECT key,CASE key WHEN 'mixed_binary' THEN 'Cap and inactive binary flushout'
            WHEN 'binary_cap' THEN 'Daily binary cap exceeded' WHEN 'inactive_binary' THEN 'Inactive member binary earnings'
            WHEN 'deactivation_wallet' THEN 'Wallet balance flushed on deactivation'
            WHEN 'direct_legacy' THEN 'Direct referral overflow (legacy reason)'
            WHEN 'product_legacy' THEN 'Product binary overflow (legacy reason)'
            ELSE 'Binary overflow (legacy reason)' END label,
          COUNT(*)::int events,COALESCE(SUM(amount),0)::float amount,COALESCE(SUM(points),0)::float points
        FROM classified GROUP BY key ORDER BY amount DESC
      `,
      prisma.$queryRaw<TrendRow[]>`
        SELECT date_trunc('day',created_at AT TIME ZONE 'Asia/Manila') AS "day",
          COUNT(*)::int events,COALESCE(SUM(amount),0)::float amount
        FROM commissions WHERE is_pair_overflow=true AND created_at>=${from} AND created_at<=${to}
        GROUP BY 1 ORDER BY 1
      `,
      prisma.$queryRaw<LedgerRow[]>`
        WITH classified AS (
          SELECT c.id,c.created_at,c.amount::float amount,COALESCE(c.points,0)::int recorded_points,
            COALESCE(e.cap_flashout_pairs+e.inactive_flashout_pairs,0)::int exact_pairs,
            CASE WHEN c.type='direct_referral' THEN 'direct_referral'
                 WHEN c.type='sponsor_point' THEN 'product_binary'
                 WHEN c.type='binary_pairing' AND COALESCE(c.points,0)=0 THEN 'deactivation'
                 ELSE 'binary' END category,
            CASE WHEN e.cap_flashout_pairs>0 AND e.inactive_flashout_pairs>0 THEN 'Cap and inactive binary flushout'
                 WHEN e.cap_flashout_pairs>0 THEN 'Daily binary cap exceeded'
                 WHEN e.inactive_flashout_pairs>0 THEN 'Inactive member binary earnings'
                 WHEN c.type='binary_pairing' AND COALESCE(c.points,0)=0 THEN 'Wallet balance flushed on deactivation'
                 WHEN c.type='direct_referral' THEN 'Direct referral overflow (legacy reason not separable)'
                 WHEN c.type='sponsor_point' THEN 'Product binary overflow (legacy reason not separable)'
                 ELSE 'Binary overflow (legacy reason not separable)' END reason,
            CASE WHEN e.id IS NOT NULL THEN 'exact' ELSE 'legacy' END data_quality,
            COALESCE(e.recipient_user_id,c.source_user_id) member_id,c.user_id recipient_id,c.source_user_id source_id,
            COALESCE(e.package_name_snapshot,p.name) package_name,
            CASE WHEN e.package_name_snapshot IS NOT NULL THEN 'event snapshot' WHEN p.name IS NOT NULL THEN 'current profile' ELSE 'unavailable' END package_source
          FROM commissions c
          LEFT JOIN binary_pair_events e ON e.flashout_commission_id=c.id
          LEFT JOIN reseller_profiles rp ON rp.user_id=COALESCE(e.recipient_user_id,c.source_user_id)
          LEFT JOIN packages p ON p.id=rp.package_id
          WHERE c.is_pair_overflow=true AND c.created_at>=${from} AND c.created_at<=${to}
        ) SELECT x.*,member.full_name member_name,member.username member_username,
          recipient.full_name recipient_name,recipient.username recipient_username,
          source.full_name source_name,source.username source_username,COUNT(*) OVER()::int total_count
        FROM classified x
        LEFT JOIN users member ON member.id=x.member_id LEFT JOIN users recipient ON recipient.id=x.recipient_id
        LEFT JOIN users source ON source.id=x.source_id
        WHERE (${category}='all' OR x.category=${category}) AND (${quality}='all' OR x.data_quality=${quality})
          AND (${search}='' OR LOWER(CONCAT_WS(' ',member.full_name,member.username,source.full_name,source.username,x.reason,x.package_name,x.id)) LIKE ${`%${search}%`})
        ORDER BY x.created_at DESC,x.id DESC LIMIT ${pageSize} OFFSET ${offset}
      `,
    ]);

    const summary = summaryRows[0] || {} as SummaryRow;
    const totalCount = number(ledgerRows[0]?.total_count);
    return NextResponse.json({
      range: { from, to },
      accounting_ready: exactAccountingAvailable,
      summary: {
        total_events: number(summary.total_events), total_amount: number(summary.total_amount),
        affected_accounts: number(summary.affected_accounts), recorded_points: number(summary.recorded_points),
        exact_binary_pairs: number(summary.exact_binary_pairs), exact_events: number(summary.exact_events),
        legacy_events: number(summary.legacy_events), exact_coverage_percent: number(summary.total_events) > 0
          ? Math.round(number(summary.exact_events) / number(summary.total_events) * 1000) / 10 : 100,
      },
      categories: categoryRows, reasons: reasonRows, trend: trendRows, records: ledgerRows,
      pagination: { page, page_size: pageSize, total_count: totalCount, total_pages: Math.max(1, Math.ceil(totalCount / pageSize)) },
      notes: {
        source: "Retained amounts come directly from immutable overflow commission rows.",
        exact: "Exact rows are linked to a binary event snapshot with saved cap/inactive pair counts and package at event time.",
        legacy: "Legacy rows preserve exact money and recorded points, but older code did not save a separable reason or historical package snapshot.",
        scope: "This is a read-only audit report. It does not recalculate or change wallets, commissions, payouts, or reserve balances.",
      },
    });
  } catch (error) {
    console.error("[FLUSHOUT REPORT]", error);
    return NextResponse.json({ error: "Unable to load flushout report." }, { status: 500 });
  }
}
