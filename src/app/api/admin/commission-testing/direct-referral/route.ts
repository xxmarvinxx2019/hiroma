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
  remaining_to_end: number;
  referrer_name: string;
  referrer_username: string;
  referred_name: string | null;
  referred_username: string | null;
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
    const [income, paid, approved, reserve, flash, ledger] = await Promise.all([
      prisma.$queryRaw<
        { count: number; amount: number }[]
      >`SELECT COUNT(*)::int count,COALESCE(SUM(original_amount),0)::float amount FROM direct_referral_reserve_lots WHERE allocated_at>=${from} AND allocated_at<=${to}`,
      prisma.$queryRaw<
        { amount: number }[]
      >`SELECT COALESCE(SUM(c.amount),0)::float amount FROM direct_referral_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE COALESCE(p.payout_date,p.processed_at,c.allocated_at)>=${from} AND COALESCE(p.payout_date,p.processed_at,c.allocated_at)<=${to} AND p.status='released'`,
      prisma.$queryRaw<
        { amount: number }[]
      >`SELECT COALESCE(SUM(c.amount),0)::float amount FROM direct_referral_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE COALESCE(p.processed_at,c.allocated_at)>=${from} AND COALESCE(p.processed_at,c.allocated_at)<=${to} AND p.status='approved'`,
      prisma.$queryRaw<
        { amount: number }[]
      >`SELECT COALESCE(SUM(l.original_amount),0)::float-COALESCE((SELECT SUM(c.amount) FROM direct_referral_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE COALESCE(p.payout_date,p.processed_at,c.allocated_at)<=${to} AND p.status='released'),0)::float amount FROM direct_referral_reserve_lots l WHERE l.allocated_at<=${to}`,
      prisma.$queryRaw<
        { count: number; amount: number }[]
      >`SELECT COUNT(*)::int count,COALESCE(SUM(amount),0)::float amount FROM commissions WHERE type='direct_referral' AND is_pair_overflow=true AND created_at>=${from} AND created_at<=${to}`,
      prisma.$queryRaw<
        LedgerRow[]
      >`SELECT l.id::text id,l.allocated_at date,l.original_amount::float amount,COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(p.payout_date,p.processed_at,c.allocated_at)<=${to} AND p.status='released'),0)::float paid_to_end,GREATEST(l.original_amount-COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(p.payout_date,p.processed_at,c.allocated_at)<=${to} AND p.status='released'),0),0)::float remaining_to_end,r.full_name referrer_name,r.username referrer_username,m.full_name referred_name,m.username referred_username FROM direct_referral_reserve_lots l JOIN commissions x ON x.id=l.commission_id JOIN users r ON r.id=l.user_id LEFT JOIN users m ON m.id=x.source_user_id LEFT JOIN direct_referral_payout_consumptions c ON c.reserve_lot_id=l.id LEFT JOIN payouts p ON p.id=c.payout_id WHERE l.allocated_at>=${from} AND l.allocated_at<=${to} GROUP BY l.id,l.allocated_at,l.original_amount,r.full_name,r.username,m.full_name,m.username ORDER BY l.allocated_at DESC LIMIT 250`,
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
      data_notes: {
        total_paid:
          "Released direct-referral payout amount in the selected period.",
        total_approved:
          "Approved direct-referral payout amount that has not yet been released.",
        total_reserve_liability:
          "Closing direct-referral amount not yet released; approved payouts remain included until release.",
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
