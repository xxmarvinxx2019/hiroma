import { Prisma } from "@prisma/client";
import { creditCommissionExactlyOnce } from "@/app/lib/commissionCredit";

type Input = {
  referrerId: string;
  newUserId: string;
  referredPackageId: string;
  sourceEventId: string;
};

export async function settleDirectReferral(
  tx: Prisma.TransactionClient,
  input: Input,
) {
  // Serialize all referrals for one sponsor so simultaneous registrations
  // cannot both consume the final payable slot of the daily cap.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.referrerId}))`;

  const profile = await tx.resellerProfile.findUnique({
    where: { user_id: input.referrerId },
    select: {
      daily_referral_count: true,
      last_referral_date: true,
      package: { select: { id: true, direct_referral_bonus: true } },
    },
  });
  if (!profile) throw new Error("Referrer package profile was not found.");

  const referredPackage = await tx.package.findUnique({
    where: { id: input.referredPackageId },
    select: { direct_referral_bonus: true },
  });
  if (!referredPackage) throw new Error("Referred package was not found.");

  const [cap] = await tx.$queryRaw<
    { enabled: boolean; cap: number; is_today: boolean }[]
  >`
    SELECT COALESCE(p.direct_referral_cap_enabled, true) AS enabled,
           COALESCE(p.daily_referral_cap, 10)::int AS cap,
           COALESCE((r.last_referral_date AT TIME ZONE 'Asia/Manila')::date =
                    (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, false) AS is_today
    FROM reseller_profiles r
    JOIN packages p ON p.id = r.package_id
    WHERE r.user_id = ${input.referrerId}
  `;

  const usedToday = cap?.is_today ? profile.daily_referral_count : 0;
  const capLimit = Math.max(0, Number(cap?.cap ?? 10));
  const capExceeded = Boolean(cap?.enabled) && usedToday >= capLimit;
  const sponsorValue = Number(profile.package.direct_referral_bonus || 0);
  const referredValue = Number(referredPackage.direct_referral_bonus || 0);
  const payable = capExceeded ? 0 : Math.min(sponsorValue, referredValue);
  const flashout = capExceeded
    ? referredValue
    : Math.max(0, referredValue - sponsorValue);
  const hiroma =
    flashout > 0
      ? await tx.user.findFirst({
          where: { username: "hiroma" },
          select: { id: true },
        })
      : null;
  if (flashout > 0 && !hiroma)
    throw new Error("Hiroma commission receiver was not found.");

  if (!capExceeded) {
    await tx.resellerProfile.update({
      where: { user_id: input.referrerId },
      data: {
        daily_referral_count: cap?.is_today ? { increment: 1 } : 1,
        last_referral_date: new Date(),
      },
    });
  }
  if (payable > 0) {
    await creditCommissionExactlyOnce(tx, {
      eventKey: `registration:${input.sourceEventId}:direct:${input.referrerId}:payable`,
      userId: input.referrerId,
      type: "direct_referral",
      amount: payable,
      sourceUserId: input.newUserId,
    });
  }
  if (flashout > 0 && hiroma) {
    await creditCommissionExactlyOnce(tx, {
      eventKey: `registration:${input.sourceEventId}:direct:${hiroma.id}:flashout`,
      userId: hiroma.id,
      type: "direct_referral",
      amount: flashout,
      sourceUserId: input.newUserId,
      isOverflow: true,
      overflowTo: hiroma.id,
    });
  }
  return { capExceeded, payable, flashout };
}
