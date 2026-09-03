import { Prisma } from "@prisma/client";
import {
  creditCommissionExactlyOnce,
  recordCommissionExactlyOnce,
} from "@/app/lib/commissionCredit";
import { lockFinancialUser } from "@/app/lib/walletLedger";

type Input = {
  referrerId: string;
  newUserId: string;
  referredDirectAllocation: number;
  sourceEventId: string;
};

type ReferrerState = {
  user_id: string;
  username: string;
  role: string;
  status: string;
  package_id: string;
  package_name: string;
  direct_referral_bonus: number | string;
  cap_enabled: boolean;
  cap_limit: number;
  effective_daily_count: number;
  settlement_day: string;
};

type SettlementEventInput = {
  sourceEventId: string;
  sponsorUserId: string;
  referredUserId: string;
  sponsorPackageId: string | null;
  packageNameSnapshot: string;
  sponsorBonusSnapshot: number;
  sourceAllocation: number;
  capEnabled: boolean;
  capLimit: number;
  settlementDay: string;
  openingCount: number;
  closingCount: number;
  recipientEligible: boolean;
  disposition: string;
  payableAmount: number;
  retainedAmount: number;
  normalCommissionId: string | null;
  retainedCommissionId: string | null;
};

async function insertSettlementEvent(
  tx: Prisma.TransactionClient,
  event: SettlementEventInput,
) {
  const inserted = await tx.$executeRaw`
    INSERT INTO "direct_referral_settlement_events" (
      "id", "registration_financial_id", "source_event_id",
      "sponsor_user_id", "referred_user_id", "sponsor_package_id",
      "package_name_snapshot", "sponsor_bonus_snapshot", "source_allocation",
      "cap_enabled", "cap_limit", "settlement_day",
      "opening_daily_referral_count", "closing_daily_referral_count",
      "recipient_eligible", "disposition", "payable_amount", "retained_amount",
      "normal_commission_id", "retained_commission_id", "created_at"
    )
    SELECT
      gen_random_uuid(), financial."id", ${event.sourceEventId},
      ${event.sponsorUserId}, ${event.referredUserId}, ${event.sponsorPackageId},
      ${event.packageNameSnapshot}, ${event.sponsorBonusSnapshot}, ${event.sourceAllocation},
      ${event.capEnabled}, ${event.capLimit}, ${event.settlementDay}::date,
      ${event.openingCount}, ${event.closingCount},
      ${event.recipientEligible}, ${event.disposition}, ${event.payableAmount}, ${event.retainedAmount},
      ${event.normalCommissionId}, ${event.retainedCommissionId}, CURRENT_TIMESTAMP
    FROM "registration_financials" financial
    WHERE financial."pin_id" = ${event.sourceEventId}
      AND financial."payment_status" = 'paid'
  `;
  if (inserted !== 1) {
    throw new Error("Direct Referral settlement has no exact paid registration source.");
  }
}

export async function settleDirectReferral(
  tx: Prisma.TransactionClient,
  input: Input,
) {
  await lockFinancialUser(tx, input.referrerId);
  // Serialize all referrals for one sponsor so simultaneous registrations
  // cannot both consume the final payable slot of the daily cap.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.referrerId}))`;

  const referredValue = Number(input.referredDirectAllocation);
  if (!Number.isFinite(referredValue) || referredValue < 0) {
    throw new Error("Referred Direct Referral allocation is invalid.");
  }

  const [state] = await tx.$queryRaw<ReferrerState[]>`
    SELECT r.user_id,
           u.username,
           u.role::text AS role,
           u.status::text AS status,
           p.id AS package_id,
           p.name AS package_name,
           p.direct_referral_bonus,
           COALESCE(p.direct_referral_cap_enabled, true) AS cap_enabled,
           GREATEST(COALESCE(p.daily_referral_cap, 10), 0)::int AS cap_limit,
           CASE
             WHEN (r.last_referral_date AT TIME ZONE 'Asia/Manila')::date =
                  (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
               THEN GREATEST(r.daily_referral_count, 0)
             ELSE 0
           END::int AS effective_daily_count,
           ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date)::text AS settlement_day
    FROM reseller_profiles r
    JOIN users u ON u.id = r.user_id
    JOIN packages p ON p.id = r.package_id
    WHERE r.user_id = ${input.referrerId}
    FOR UPDATE OF r, u FOR SHARE OF p
  `;
  if (!state) throw new Error("Referrer package profile was not found.");

  const usedToday = Number(state.effective_daily_count);
  const capLimit = Number(state.cap_limit);
  const capExceeded = Boolean(state.cap_enabled) && usedToday >= capLimit;
  const recipientUnavailable =
    state.role !== "reseller" || state.status !== "active";
  const retained = capExceeded || recipientUnavailable;
  const sponsorValue = Number(state.direct_referral_bonus || 0);
  const payable = retained ? 0 : Math.min(sponsorValue, referredValue);
  const flashout = retained
    ? referredValue
    : Math.max(0, referredValue - sponsorValue);
  const hiroma =
    flashout > 0
      ? await tx.user.findFirst({
          where: { username: "hiroma", role: "admin", status: "active" },
          select: { id: true },
        })
      : null;
  if (flashout > 0 && !hiroma)
    throw new Error("Hiroma commission receiver was not found.");

  let normalCommissionId: string | null = null;
  let retainedCommissionId: string | null = null;
  if (payable > 0) {
    const commission = await creditCommissionExactlyOnce(tx, {
      eventKey: `registration:${input.sourceEventId}:direct:${input.referrerId}:payable`,
      sourceEventKind: "registration",
      sourceEventId: input.sourceEventId,
      ruleVersion: "registration-direct-v1",
      userId: input.referrerId,
      type: "direct_referral",
      amount: payable,
      sourceUserId: input.newUserId,
    });
    normalCommissionId = commission.id;
  }
  if (flashout > 0 && hiroma) {
    const commission = await recordCommissionExactlyOnce(tx, {
      eventKey: `registration:${input.sourceEventId}:direct:${hiroma.id}:flashout`,
      sourceEventKind: "registration",
      sourceEventId: input.sourceEventId,
      ruleVersion: "registration-direct-v1",
      userId: hiroma.id,
      type: "direct_referral",
      amount: flashout,
      sourceUserId: input.newUserId,
      isOverflow: true,
      overflowTo: hiroma.id,
    });
    retainedCommissionId = commission.id;
  }

  const countedReferral = !capExceeded && !recipientUnavailable;
  const disposition = recipientUnavailable
    ? "retained_ineligible"
    : capExceeded
      ? "retained_cap"
      : payable <= 0
        ? "retained_package_difference"
        : flashout > 0
          ? "paid_with_package_remainder"
          : "paid";
  await insertSettlementEvent(tx, {
    sourceEventId: input.sourceEventId,
    sponsorUserId: input.referrerId,
    referredUserId: input.newUserId,
    sponsorPackageId: state.package_id,
    packageNameSnapshot: state.package_name,
    sponsorBonusSnapshot: sponsorValue,
    sourceAllocation: referredValue,
    capEnabled: Boolean(state.cap_enabled),
    capLimit,
    settlementDay: state.settlement_day,
    openingCount: usedToday,
    closingCount: usedToday + (countedReferral ? 1 : 0),
    recipientEligible: !recipientUnavailable,
    disposition,
    payableAmount: payable,
    retainedAmount: flashout,
    normalCommissionId,
    retainedCommissionId,
  });

  // The event is inserted while the locked opening counter is still current;
  // its deferred database verifier then proves this exact closing state.
  if (countedReferral) {
    await tx.$executeRaw`
      UPDATE reseller_profiles
      SET daily_referral_count = ${usedToday + 1},
          last_referral_date = CURRENT_TIMESTAMP
      WHERE user_id = ${input.referrerId}
    `;
  }

  return { capExceeded, payable, flashout };
}

export async function recordSystemDirectReferralRetention(
  tx: Prisma.TransactionClient,
  input: Input,
) {
  await lockFinancialUser(tx, input.referrerId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.referrerId}))`;

  const referredValue = Number(input.referredDirectAllocation);
  if (!Number.isFinite(referredValue) || referredValue < 0) {
    throw new Error("Referred Direct Referral allocation is invalid.");
  }
  const [systemAccount] = await tx.$queryRaw<
    { id: string; settlement_day: string }[]
  >`
    SELECT id,
           ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date)::text AS settlement_day
    FROM users
    WHERE id = ${input.referrerId}
      AND username = 'hiroma'
      AND role = 'admin'::"Role"
    FOR UPDATE
  `;
  if (!systemAccount) throw new Error("Hiroma system referrer was not found.");

  await insertSettlementEvent(tx, {
    sourceEventId: input.sourceEventId,
    sponsorUserId: input.referrerId,
    referredUserId: input.newUserId,
    sponsorPackageId: null,
    packageNameSnapshot: "Hiroma system root",
    sponsorBonusSnapshot: 0,
    sourceAllocation: referredValue,
    capEnabled: false,
    capLimit: 0,
    settlementDay: systemAccount.settlement_day,
    openingCount: 0,
    closingCount: 0,
    recipientEligible: false,
    disposition: "retained_system_root",
    payableAmount: 0,
    retainedAmount: referredValue,
    normalCommissionId: null,
    retainedCommissionId: null,
  });

  return { capExceeded: false, payable: 0, flashout: referredValue };
}
