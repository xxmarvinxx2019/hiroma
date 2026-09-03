import { Prisma } from "@prisma/client";
import {
  creditCommissionExactlyOnce,
  recordCommissionExactlyOnce,
} from "@/app/lib/commissionCredit";
import { lockFinancialUser } from "@/app/lib/walletLedger";

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
  depth: number;
};

type CapRow = {
  user_id: string;
  enabled: boolean;
  cap: number;
  is_today: boolean;
};

type ReserveRow = {
  available_amount: string | number | null;
};

function toCentavos(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount))
    throw new Error("Binary reserve funding state is invalid.");
  return Math.round(amount * 100);
}

export class InsufficientBinaryReserveError extends Error {
  constructor(
    public readonly requiredAmount: number,
    public readonly availableAmount: number,
  ) {
    super(
      `Protected binary reserve is insufficient. Required ₱${requiredAmount.toFixed(2)}, available ₱${availableAmount.toFixed(2)}.`,
    );
    this.name = "InsufficientBinaryReserveError";
  }
}

export class DuplicateBinarySettlementError extends Error {
  constructor() {
    super("This registration or upgrade binary volume was already settled.");
    this.name = "DuplicateBinarySettlementError";
  }
}

export async function settleBinaryCommission(
  tx: Prisma.TransactionClient,
  input: Input,
) {
  if (input.sourcePoints <= 0)
    return { completedPairs: 0, payableAmount: 0, flashoutAmount: 0 };

  if (!input.sourceEventId || input.sourceEventId.length > 255)
    throw new Error("Invalid binary source event.");

  // One immutable registration/upgrade event may add volume only once. The
  // database unique key is the final boundary; this lock gives retries a clear
  // error before any carryover or commission work starts.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`binary-settlement:${input.sourceKind}:${input.sourceEventId}`}))`;
  const priorSettlement = await tx.binarySettlementEvent.findUnique({
    where: {
      source_kind_source_event_id: {
        source_kind: input.sourceKind,
        source_event_id: input.sourceEventId,
      },
    },
    select: { id: true },
  });
  if (priorSettlement) throw new DuplicateBinarySettlementError();

  const ancestors = await tx.$queryRaw<Ancestor[]>`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, user_id, parent_id, position, 1 AS depth
      FROM binary_tree_nodes WHERE id = ${input.parentNodeId}
      UNION ALL
      SELECT n.id, n.user_id, n.parent_id, n.position, a.depth + 1
      FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, user_id, parent_id, position, depth
    FROM ancestor_chain
    ORDER BY depth ASC
  `;
  if (ancestors.length === 0)
    return { completedPairs: 0, payableAmount: 0, flashoutAmount: 0 };

  // Lock every affected member in stable order. Concurrent registrations can
  // no longer spend the same carryover points or final daily-cap slot twice.
  for (const userId of [
    ...new Set(ancestors.map((row) => row.user_id)),
  ].sort()) {
    await lockFinancialUser(tx, userId);
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
    where: { username: "hiroma", role: "admin", status: "active" },
    select: { id: true },
  });

  const plans: Array<{
    ancestor: Ancestor;
    profile: (typeof profiles)[number];
    cap: CapRow | undefined;
    sourceLeg: "left" | "right";
    pointsPerPair: number;
    openingLeftPoints: number;
    openingRightPoints: number;
    leftPoints: number;
    rightPoints: number;
    completedPairs: number;
    withinCap: number;
    capLimit: number;
    capFlashoutPairs: number;
    payablePairs: number;
    inactiveFlashoutPairs: number;
    flashoutPairs: number;
    payableAmount: number;
    flashoutAmount: number;
    consumedPoints: number;
  }> = [];
  let currentLeg = input.position;

  // Plan the complete cascade from the locked carryover/cap snapshots. Nothing
  // financial or spendable is written until the whole member liability is
  // known and checked against the protected pool.
  for (const ancestor of ancestors) {
    const profile = profileMap.get(ancestor.user_id);
    if (!profile) {
      currentLeg = (ancestor.position as "left" | "right") || currentLeg;
      continue;
    }

    const sourceLeg = currentLeg;
    const pointsPerPair = Math.max(
      0,
      Math.round(Number(profile.package.pairing_bonus_value || 0)),
    );
    const openingLeftPoints = Number(profile.left_points || 0);
    const openingRightPoints = Number(profile.right_points || 0);
    let leftPoints = openingLeftPoints;
    let rightPoints = openingRightPoints;
    if (sourceLeg === "left") leftPoints += input.sourcePoints;
    else rightPoints += input.sourcePoints;

    const completedPairs =
      pointsPerPair > 0
        ? Math.floor(Math.min(leftPoints, rightPoints) / pointsPerPair)
        : 0;
    const cap = capMap.get(ancestor.user_id);
    const usedToday = cap?.is_today
      ? Number(profile.daily_pairing_count || 0)
      : 0;
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
    const consumedPoints = completedPairs * pointsPerPair;
    leftPoints -= consumedPoints;
    rightPoints -= consumedPoints;

    plans.push({
      ancestor,
      profile,
      cap,
      sourceLeg,
      pointsPerPair,
      openingLeftPoints,
      openingRightPoints,
      leftPoints,
      rightPoints,
      completedPairs,
      withinCap,
      capLimit,
      capFlashoutPairs,
      payablePairs,
      inactiveFlashoutPairs,
      flashoutPairs,
      payableAmount,
      flashoutAmount,
      consumedPoints,
    });
    currentLeg = (ancestor.position as "left" | "right") || currentLeg;
  }

  const totalCompleted = plans.reduce(
    (sum, plan) => sum + plan.completedPairs,
    0,
  );
  const totalPayable = plans.reduce(
    (sum, plan) => sum + plan.payableAmount,
    0,
  );
  const totalFlashout = plans.reduce(
    (sum, plan) => sum + plan.flashoutAmount,
    0,
  );

  if (totalFlashout > 0 && !hiroma)
    throw new Error("Hiroma binary flashout receiver was not found.");

  // Use the exact same global lock as the database reserve-consumption trigger.
  // It stays held through all commission inserts, so another cascade cannot
  // consume the funds between this aggregate check and the actual credits.
  if (totalPayable > 0) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('binary-reserve-funding'))`;
    const [reserve] = await tx.$queryRaw<ReserveRow[]>`
      SELECT COALESCE(SUM("remaining_amount"), 0)::text AS "available_amount"
      FROM "binary_reserve_lots"
      WHERE "remaining_amount" > 0
    `;
    const availableAmount = Number(reserve?.available_amount || 0);
    if (toCentavos(availableAmount) < toCentavos(totalPayable))
      throw new InsufficientBinaryReserveError(
        totalPayable,
        availableAmount,
      );
  }

  await tx.binarySettlementEvent.create({
    data: {
      source_kind: input.sourceKind,
      source_event_id: input.sourceEventId,
      source_user_id: input.sourceUserId,
      source_points: input.sourcePoints,
      parent_node_id: input.parentNodeId,
      source_leg: input.position,
    },
  });

  for (const plan of plans) {
    const {
      ancestor,
      profile,
      cap,
      sourceLeg,
      pointsPerPair,
      openingLeftPoints,
      openingRightPoints,
      leftPoints,
      rightPoints,
      completedPairs,
      withinCap,
      capLimit,
      capFlashoutPairs,
      payablePairs,
      inactiveFlashoutPairs,
      flashoutPairs,
      payableAmount,
      flashoutAmount,
      consumedPoints,
    } = plan;

    const normalCommission =
      payableAmount > 0
        ? await creditCommissionExactlyOnce(tx, {
            eventKey: `${input.sourceKind}:${input.sourceEventId}:binary:${ancestor.user_id}:payable`,
            sourceEventKind: input.sourceKind,
            sourceEventId: input.sourceEventId,
            ruleVersion: "package-binary-v1",
            userId: ancestor.user_id,
            type: "binary_pairing",
            amount: payableAmount,
            points: payablePairs * pointsPerPair,
            sourceUserId: input.sourceUserId,
          })
        : null;

    // Cap and inactive flashouts are company-retained accounting evidence.
    // They must never consume the member reserve or become withdrawable.
    const flashoutCommission =
      flashoutAmount > 0 && hiroma
        ? await recordCommissionExactlyOnce(tx, {
            eventKey: `${input.sourceKind}:${input.sourceEventId}:binary:${ancestor.user_id}:flashout`,
            sourceEventKind: input.sourceKind,
            sourceEventId: input.sourceEventId,
            ruleVersion: "package-binary-v1",
            userId: hiroma.id,
            type: "binary_pairing",
            amount: flashoutAmount,
            points: flashoutPairs * pointsPerPair,
            sourceUserId: input.sourceUserId,
            overflowTo: hiroma.id,
            isOverflow: true,
          })
        : null;

    // Insert the immutable event while the profile still contains the exact
    // opening carryover. The database validates that opening snapshot and then
    // defers a second check until commit to prove this transaction applied the
    // event's exact closing carryover/cap state.
    await tx.binaryPairEvent.create({
      data: {
        recipient_user_id: ancestor.user_id,
        source_user_id: input.sourceUserId,
        source_kind: input.sourceKind,
        source_event_id: input.sourceEventId,
        source_leg: sourceLeg,
        source_points: input.sourcePoints,
        recipient_package_id: profile.package.id,
        package_name_snapshot: profile.package.name,
        pair_value_snapshot: pointsPerPair * PESO_PER_POINT,
        package_snapshot_source: "exact_event",
        points_per_pair: pointsPerPair,
        peso_per_point: PESO_PER_POINT,
        opening_left_points: openingLeftPoints,
        opening_right_points: openingRightPoints,
        closing_left_points: leftPoints,
        closing_right_points: rightPoints,
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
    if (completedPairs > 0) {
      await tx.pairingLog.create({
        data: {
          member_id: ancestor.user_id,
          left_points_used: consumedPoints,
          right_points_used: consumedPoints,
          pairs_created: completedPairs,
          commission: payableAmount,
        },
      });
    }
  }

  return {
    completedPairs: totalCompleted,
    payableAmount: totalPayable,
    flashoutAmount: totalFlashout,
  };
}
