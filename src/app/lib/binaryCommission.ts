import { Prisma } from "@prisma/client";
import { creditCommissionExactlyOnce } from "@/app/lib/commissionCredit";

const PESO_PER_POINT = 0.5;

type BinarySourceKind = "registration" | "upgrade";

type Input = {
  sourceUserId: string;
  sourcePoints: number;
  parentNodeId: string;
  position: "left" | "right";
  sourceKind: BinarySourceKind;
  sourceEventId: string;
};

type Ancestor = {
  id: string;
  user_id: string;
  parent_id: string | null;
  position: string | null;
};

type CapRow = {
  user_id: string;
  enabled: boolean;
  cap: number;
  is_today: boolean;
};

export async function settleBinaryCommission(
  tx: Prisma.TransactionClient,
  input: Input,
) {
  if (input.sourcePoints <= 0)
    return { completedPairs: 0, payableAmount: 0, flashoutAmount: 0 };

  const ancestors = await tx.$queryRaw<Ancestor[]>`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, user_id, parent_id, position
      FROM binary_tree_nodes WHERE id = ${input.parentNodeId}
      UNION ALL
      SELECT n.id, n.user_id, n.parent_id, n.position
      FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, user_id, parent_id, position FROM ancestor_chain
  `;
  if (ancestors.length === 0)
    return { completedPairs: 0, payableAmount: 0, flashoutAmount: 0 };

  // Lock every affected member in stable order. Concurrent registrations can
  // no longer spend the same carryover points or final daily-cap slot twice.
  for (const userId of [
    ...new Set(ancestors.map((row) => row.user_id)),
  ].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"binary:" + userId}))`;
  }

  const profiles = await tx.resellerProfile.findMany({
    where: { user_id: { in: ancestors.map((row) => row.user_id) } },
    select: {
      user_id: true,
      left_points: true,
      right_points: true,
      daily_pairing_count: true,
      package: { select: { id: true, name: true, pairing_bonus_value: true } },
      user: { select: { status: true } },
    },
  });
  const profileMap = new Map(
    profiles.map((profile) => [profile.user_id, profile]),
  );
  const caps = await tx.$queryRaw<CapRow[]>`
    SELECT r.user_id::text,
           COALESCE(p.binary_pair_cap_enabled, true) AS enabled,
           COALESCE(p.daily_binary_pair_cap, 10)::int AS cap,
           COALESCE(r.daily_pairing_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, false) AS is_today
    FROM reseller_profiles r
    JOIN packages p ON p.id = r.package_id
    WHERE r.user_id::text = ANY(${ancestors.map((row) => row.user_id)}::text[])
  `;
  const capMap = new Map(caps.map((cap) => [cap.user_id, cap]));
  const hiroma = await tx.user.findFirst({
    where: { username: "hiroma" },
    select: { id: true },
  });

  let currentLeg = input.position;
  let totalCompleted = 0;
  let totalPayable = 0;
  let totalFlashout = 0;

  for (const ancestor of ancestors) {
    const profile = profileMap.get(ancestor.user_id);
    if (!profile) {
      currentLeg = (ancestor.position as "left" | "right") || currentLeg;
      continue;
    }

    const pointsPerPair = Math.max(
      0,
      Math.round(Number(profile.package.pairing_bonus_value || 0)),
    );
    let leftPoints = Number(profile.left_points || 0);
    let rightPoints = Number(profile.right_points || 0);
    if (currentLeg === "left") leftPoints += input.sourcePoints;
    else rightPoints += input.sourcePoints;

    if (pointsPerPair <= 0) {
      await tx.resellerProfile.update({
        where: { user_id: ancestor.user_id },
        data: { left_points: leftPoints, right_points: rightPoints },
      });
      currentLeg = (ancestor.position as "left" | "right") || currentLeg;
      continue;
    }

    const completedPairs = Math.floor(
      Math.min(leftPoints, rightPoints) / pointsPerPair,
    );
    if (completedPairs === 0) {
      await tx.resellerProfile.update({
        where: { user_id: ancestor.user_id },
        data: { left_points: leftPoints, right_points: rightPoints },
      });
      currentLeg = (ancestor.position as "left" | "right") || currentLeg;
      continue;
    }

    const cap = capMap.get(ancestor.user_id);
    const usedToday = cap?.is_today ? profile.daily_pairing_count : 0;
    const capLimit = Math.max(1, Number(cap?.cap ?? 10));
    const withinCap =
      cap?.enabled === false
        ? completedPairs
        : Math.min(completedPairs, Math.max(0, capLimit - usedToday));
    const capFlashoutPairs = completedPairs - withinCap;
    const isActive = profile.user.status === "active";
    const payablePairs = isActive ? withinCap : 0;
    const inactiveFlashoutPairs = isActive ? 0 : withinCap;
    const flashoutPairs = capFlashoutPairs + inactiveFlashoutPairs;
    const payableAmount = payablePairs * pointsPerPair * PESO_PER_POINT;
    const flashoutAmount = flashoutPairs * pointsPerPair * PESO_PER_POINT;
    if (flashoutAmount > 0 && !hiroma)
      throw new Error("Hiroma binary flashout receiver was not found.");

    const consumedPoints = completedPairs * pointsPerPair;
    leftPoints -= consumedPoints;
    rightPoints -= consumedPoints;

    const normalCommission =
      payableAmount > 0
        ? await creditCommissionExactlyOnce(tx, {
            eventKey: `${input.sourceKind}:${input.sourceEventId}:binary:${ancestor.user_id}:payable`,
            userId: ancestor.user_id,
            type: "binary_pairing",
            amount: payableAmount,
            points: payablePairs * pointsPerPair,
            sourceUserId: input.sourceUserId,
          })
        : null;

    const flashoutCommission =
      flashoutAmount > 0 && hiroma
        ? await creditCommissionExactlyOnce(tx, {
            eventKey: `${input.sourceKind}:${input.sourceEventId}:binary:${ancestor.user_id}:flashout`,
            userId: hiroma.id,
            type: "binary_pairing",
            amount: flashoutAmount,
            points: flashoutPairs * pointsPerPair,
            sourceUserId: input.sourceUserId,
            overflowTo: hiroma.id,
            isOverflow: true,
          })
        : null;

    await tx.resellerProfile.update({
      where: { user_id: ancestor.user_id },
      data: {
        left_points: leftPoints,
        right_points: rightPoints,
        daily_pairing_count: cap?.is_today
          ? { increment: withinCap }
          : withinCap,
      },
    });
    await tx.$executeRaw`
      UPDATE reseller_profiles
      SET daily_pairing_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
      WHERE user_id = ${ancestor.user_id}
    `;
    await tx.pairingLog.create({
      data: {
        member_id: ancestor.user_id,
        left_points_used: consumedPoints,
        right_points_used: consumedPoints,
        pairs_created: completedPairs,
        commission: payableAmount,
      },
    });
    await tx.binaryPairEvent.create({
      data: {
        recipient_user_id: ancestor.user_id,
        source_user_id: input.sourceUserId,
        source_kind: input.sourceKind,
        source_leg: currentLeg,
        source_points: input.sourcePoints,
        recipient_package_id: profile.package.id,
        package_name_snapshot: profile.package.name,
        pair_value_snapshot: pointsPerPair * PESO_PER_POINT,
        package_snapshot_source: "exact_event",
        points_per_pair: pointsPerPair,
        peso_per_point: PESO_PER_POINT,
        completed_pairs: completedPairs,
        payable_pairs: payablePairs,
        cap_flashout_pairs: capFlashoutPairs,
        inactive_flashout_pairs: inactiveFlashoutPairs,
        consumed_left_points: consumedPoints,
        consumed_right_points: consumedPoints,
        payable_amount: payableAmount,
        flashout_amount: flashoutAmount,
        cap_enabled: cap?.enabled !== false,
        cap_limit: cap?.enabled === false ? null : capLimit,
        normal_commission_id: normalCommission?.id || null,
        flashout_commission_id: flashoutCommission?.id || null,
      },
    });

    totalCompleted += completedPairs;
    totalPayable += payableAmount;
    totalFlashout += flashoutAmount;
    currentLeg = (ancestor.position as "left" | "right") || currentLeg;
  }

  return {
    completedPairs: totalCompleted,
    payableAmount: totalPayable,
    flashoutAmount: totalFlashout,
  };
}
