import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hashPassword } from "@/app/lib/auth";
import { createAuditLog, formatMemberId } from "@/app/lib/auditLog";
import prisma from "@/app/lib/prisma";
import {
  buildPersonName,
  hasCompletePersonName,
  isPersonSuffix,
  normalizePersonName,
} from "@/app/lib/nameFormat";
import { generateUsernamePlan } from "@/app/lib/usernameGenerator";
import {
  hashIdentityDocument,
  validateIdentityDocument,
} from "@/app/lib/identityDocument";
import { generateMemberId } from "@/app/lib/memberId";
import { settleDirectReferral } from "@/app/lib/directReferral";
import { settleBinaryCommission } from "@/app/lib/binaryCommission";
import {
  claimUnusedPin,
  PinAlreadyClaimedError,
} from "@/app/lib/pinRedemption";
import {
  assertPlacementWithinReferrerSubtree,
  InvalidBinaryTreePlacementError,
  isBinaryTreeSlotConflict,
} from "@/app/lib/binaryTreePlacement";
import {
  claimIdentityAccountSlot,
  IdentityAccountLimitError,
} from "@/app/lib/identityAccountLimit";
import { Prisma } from "@prisma/client";
import { recordInventoryOutEvents } from "@/app/lib/inventoryEvent";
// import { sendSMS, smsWelcomeReseller } from '@/app/lib/sms' // commented out to save SMS costs

// ============================================================
// GET — paginated resellers
// ============================================================

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "city") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get("pageSize") || "15")),
    );
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "all";
    const packageId = searchParams.get("package") || "all";
    const sort = searchParams.get("sort") || "newest";

    const where: Prisma.UserWhereInput = {
      role: "reseller",
      created_by: user.id,
    };
    if (search) {
      where.OR = [
        { full_name: { contains: search, mode: "insensitive" } },
        { username: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status !== "all") where.status = status === "active" ? "active" : { not: "active" };
    if (packageId !== "all") where.reseller_profile = { is: { package_id: packageId } };

    const ownerWhere: Prisma.UserWhereInput = { role: "reseller", created_by: user.id };
    const orderBy: Prisma.UserOrderByWithRelationInput =
      sort === "oldest" ? { created_at: "asc" } :
      sort === "name_asc" ? { full_name: "asc" } :
      sort === "name_desc" ? { full_name: "desc" } : { created_at: "desc" };

    const [total, resellers, active, inactive, packageOptions] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
        id: true,
        member_id: true,
        full_name: true,
        username: true,
        email: true,
        mobile: true,
        address: true,
        status: true,
        created_at: true,
        reseller_profile: {
          select: {
            total_points: true,
            package: { select: { id: true, name: true, pairing_bonus_value: true } },
          },
        },
        wallet: { select: { balance: true } },
        },
      }),
      prisma.user.count({ where: { ...ownerWhere, status: "active" } }),
      prisma.user.count({ where: { ...ownerWhere, status: { not: "active" } } }),
      prisma.package.findMany({
        where: { is_active: true },
        select: { id: true, name: true, pairing_bonus_value: true },
        orderBy: { pairing_bonus_value: "asc" },
      }),
    ]);

    const upgrades = resellers.length
      ? await prisma.upgradeFinancial.findMany({
          where: { city_dist_id: user.id, reseller_id: { in: resellers.map((item) => item.id) } },
          orderBy: { created_at: "desc" },
          select: {
            id: true,
            reseller_id: true,
            from_package_name_snapshot: true,
            to_package_name_snapshot: true,
            customer_payment: true,
            created_at: true,
          },
        })
      : [];

    const enrichedResellers = resellers.map((reseller) => ({
      ...reseller,
      has_higher_package: packageOptions.some(
        (pkg) => Number(pkg.pairing_bonus_value) > Number(reseller.reseller_profile?.package?.pairing_bonus_value || 0),
      ),
      upgrade_history: upgrades
        .filter((upgrade) => upgrade.reseller_id === reseller.id)
        .map((upgrade) => ({ ...upgrade, customer_payment: Number(upgrade.customer_payment) })),
    }));

    return NextResponse.json({
      resellers: enrichedResellers,
      summary: { total: active + inactive, active, inactive },
      packageOptions: packageOptions.map((pkg) => ({ ...pkg, pairing_bonus_value: Number(pkg.pairing_bonus_value) })),
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) {
    console.error("[CITY GET RESELLERS ERROR]", error);
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 },
    );
  }
}

// ============================================================
// HELPERS
// ============================================================

async function updateAncestorCounts(
  parentNodeId: string,
  positionUnderParent: "left" | "right",
) {
  const ancestors = await prisma.$queryRaw<
    {
      id: string;
      parent_id: string | null;
      position: string | null;
    }[]
  >`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, parent_id, position
      FROM binary_tree_nodes
      WHERE id = ${parentNodeId}
      UNION ALL
      SELECT n.id, n.parent_id, n.position
      FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, parent_id, position FROM ancestor_chain
  `;

  if (!ancestors || ancestors.length === 0) return;

  const updates: Promise<unknown>[] = [];
  for (let i = 0; i < ancestors.length; i++) {
    const node = ancestors[i];
    const side =
      i === 0
        ? positionUnderParent
        : (ancestors[i - 1].position as "left" | "right");
    if (!side) continue;
    updates.push(
      side === "left"
        ? prisma.$executeRaw`UPDATE binary_tree_nodes SET left_count = left_count + 1 WHERE id = ${node.id}`
        : prisma.$executeRaw`UPDATE binary_tree_nodes SET right_count = right_count + 1 WHERE id = ${node.id}`,
    );
  }
  await Promise.all(updates);
}

function ledgerAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}
async function creditDirectReferralBonus(
  referrerId: string,
  newUserId: string,
  referrerBonus: number, // referrer's package direct_referral_bonus
  referredBonus: number, // referred's package direct_referral_bonus
) {
  if (referrerBonus <= 0 && referredBonus <= 0) return;

  // Referrer earns MIN(referrer bonus, referred bonus)
  const earned = Math.min(referrerBonus, referredBonus);
  // Overflow = MAX(0, referrer bonus - referred bonus) → goes to Hiroma
  const overflow = Math.max(0, referredBonus - referrerBonus);

  const hiromaUser = await prisma.user.findFirst({
    where: { username: "hiroma" },
    select: { id: true },
  });

  const ops: Promise<unknown>[] = [];

  if (earned > 0) {
    ops.push(
      prisma.commission.create({
        data: {
          user_id: referrerId,
          type: "direct_referral",
          amount: earned,
          source_user_id: newUserId,
          is_pair_overflow: false,
        },
      }),
      prisma.wallet.update({
        where: { user_id: referrerId },
        data: {
          balance: { increment: earned },
          total_earned: { increment: earned },
        },
      }),
    );
  }

  if (overflow > 0 && hiromaUser) {
    ops.push(
      prisma.commission.create({
        data: {
          user_id: hiromaUser.id,
          type: "direct_referral",
          amount: overflow,
          source_user_id: newUserId,
          is_pair_overflow: true,
          overflow_to: hiromaUser.id,
        },
      }),
      prisma.wallet.upsert({
        where: { user_id: hiromaUser.id },
        update: {
          balance: { increment: overflow },
          total_earned: { increment: overflow },
        },
        create: {
          user_id: hiromaUser.id,
          balance: overflow,
          total_earned: overflow,
          total_withdrawn: 0,
        },
      }),
    );
  }

  await Promise.all(ops);
}

// ============================================================
// BINARY PAIRING
// ============================================================

const BINARY_POINT_TO_PESO = 0.5;

async function firePointsPairingBonus(
  newUserId: string,
  newUserPts: number,
  parentNodeId: string,
  newPosition: "left" | "right",
) {
  if (newUserPts <= 0) return;

  // Fetch entire ancestor chain via CTE
  const ancestors = await prisma.$queryRaw<
    {
      id: string;
      user_id: string;
      parent_id: string | null;
      position: string | null;
    }[]
  >`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, user_id, parent_id, position
      FROM binary_tree_nodes
      WHERE id = ${parentNodeId}
      UNION ALL
      SELECT n.id, n.user_id, n.parent_id, n.position
      FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, user_id, parent_id, position FROM ancestor_chain
  `;

  if (!ancestors || ancestors.length === 0) return;

  const hiromaUser = await prisma.user.findFirst({
    where: { username: "hiroma" },
    select: { id: true },
  });

  // Fetch reseller profiles + their package pairing_bonus_value
  const ancestorUserIds = ancestors.map((a) => a.user_id);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Batch fetch ALL ancestor profiles in ONE query
  const ancestorProfiles = await prisma.resellerProfile.findMany({
    where: { user_id: { in: ancestorUserIds } },
    select: {
      user_id: true,
      left_points: true,
      right_points: true,
      daily_pairing_count: true,
      daily_pairing_date: true,
      package: { select: { id: true, pairing_bonus_value: true } },
      user: { select: { status: true } },
    },
  });
  const profileMap = new Map(ancestorProfiles.map((p) => [p.user_id, p]));
  const ancestorPackageIds = [
    ...new Set(ancestorProfiles.map((p) => p.package?.id).filter(Boolean)),
  ] as string[];
  const binaryCaps = ancestorPackageIds.length
    ? await prisma.$queryRaw<{ id: string; enabled: boolean; cap: number }[]>`
        SELECT id::text,
               COALESCE(binary_pair_cap_enabled, true) AS enabled,
               COALESCE(daily_binary_pair_cap, 10)::int AS cap
        FROM packages
        WHERE id::text = ANY(${ancestorPackageIds}::text[])
      `
    : [];
  const binaryCapMap = new Map(binaryCaps.map((row) => [row.id, row]));

  let currentLeg = newPosition;

  for (let i = 0; i < ancestors.length; i++) {
    const ancestor = ancestors[i];
    const profile = profileMap.get(ancestor.user_id);

    if (!profile) {
      currentLeg = (ancestor.position as "left" | "right") || currentLeg;
      continue;
    }

    const ancestorPkgPts = Number(profile.package?.pairing_bonus_value || 0);
    if (ancestorPkgPts <= 0) {
      currentLeg = (ancestor.position as "left" | "right") || currentLeg;
      continue;
    }

    const lastPairDate = profile.daily_pairing_date
      ? new Date(profile.daily_pairing_date)
      : null;
    const isToday = lastPairDate ? lastPairDate >= today : false;

    let leftPts = Number(profile.left_points || 0);
    let rightPts = Number(profile.right_points || 0);

    // Add new reseller's points to correct leg
    if (currentLeg === "left") leftPts += newUserPts;
    else rightPts += newUserPts;

    // A pair always consumes the ancestor account package's configured
    // registration-binary points from EACH side. Any complete pairs are
    // processed in this event; unmatched points remain as carryover.
    const matchable = Math.min(leftPts, rightPts);
    const pointsPerPair = ancestorPkgPts;
    const possiblePairs = Math.floor(matchable / pointsPerPair);

    if (possiblePairs > 0) {
      const usedToday = isToday ? Number(profile.daily_pairing_count || 0) : 0; // resets count on new day
      const capConfig = profile.package?.id
        ? binaryCapMap.get(profile.package.id)
        : undefined;
      const remaining =
        capConfig?.enabled === false
          ? possiblePairs
          : Math.max(0, Number(capConfig?.cap ?? 10) - usedToday);

      const paidPairs = Math.min(possiblePairs, remaining);
      const overflowPairs = possiblePairs - paidPairs;

      // earnings based on ancestor's OWN package points (not matchable)
      const paidEarnings = paidPairs * pointsPerPair * BINARY_POINT_TO_PESO;
      const overflowEarnings =
        overflowPairs * pointsPerPair * BINARY_POINT_TO_PESO;

      // Paid and cap-overflow pairs are both completed pairs, so both consume
      // points. Only incomplete points remain as carryover.
      const deduct = pointsPerPair * possiblePairs;
      leftPts -= deduct;
      rightPts -= deduct;

      // Check if ancestor is active — deactivated ancestors get flushed to Hiroma
      const isAncestorActive = profile.user?.status === "active";

      // Batch paid + overflow writes
      const writeOps: Promise<unknown>[] = [];
      if (paidPairs > 0 && paidEarnings > 0) {
        if (isAncestorActive) {
          // Active ancestor — credit normally
          writeOps.push(
            prisma.commission.create({
              data: {
                user_id: ancestor.user_id,
                type: "binary_pairing",
                amount: paidEarnings,
                points: paidPairs * pointsPerPair,
                source_user_id: newUserId,
                is_pair_overflow: false,
              },
            }),
            prisma.wallet.update({
              where: { user_id: ancestor.user_id },
              data: {
                balance: { increment: paidEarnings },
                total_earned: { increment: paidEarnings },
              },
            }),
          );
        } else if (hiromaUser) {
          // Deactivated ancestor — flush to Hiroma, source_user_id = deactivated ancestor so we know where it came from
          writeOps.push(
            prisma.commission.create({
              data: {
                user_id: hiromaUser.id,
                type: "binary_pairing",
                amount: paidEarnings,
                points: paidPairs * pointsPerPair,
                source_user_id: ancestor.user_id,
                overflow_to: hiromaUser.id,
                is_pair_overflow: true,
              },
            }),
            prisma.wallet.upsert({
              where: { user_id: hiromaUser.id },
              update: {
                balance: { increment: paidEarnings },
                total_earned: { increment: paidEarnings },
              },
              create: {
                user_id: hiromaUser.id,
                balance: paidEarnings,
                total_earned: paidEarnings,
                total_withdrawn: 0,
              },
            }),
          );
        }
      }
      if (overflowPairs > 0 && overflowEarnings > 0 && hiromaUser) {
        writeOps.push(
          prisma.commission.create({
            data: {
              user_id: hiromaUser.id,
              type: "binary_pairing",
              amount: overflowEarnings,
              points: overflowPairs * pointsPerPair,
              source_user_id: newUserId,
              overflow_to: hiromaUser.id,
              is_pair_overflow: true,
            },
          }),
          prisma.wallet.upsert({
            where: { user_id: hiromaUser.id },
            update: {
              balance: { increment: overflowEarnings },
              total_earned: { increment: overflowEarnings },
            },
            create: {
              user_id: hiromaUser.id,
              balance: overflowEarnings,
              total_earned: overflowEarnings,
              total_withdrawn: 0,
            },
          }),
        );
      }
      await Promise.all(writeOps);

      await prisma.$executeRaw`
        INSERT INTO pairing_logs (id, member_id, left_points_used, right_points_used, pairs_created, commission, date_created)
        VALUES (
          gen_random_uuid(),
          ${ancestor.user_id},
          ${currentLeg === "left" ? deduct : 0},
          ${currentLeg === "right" ? deduct : 0},
          ${paidPairs},
          ${paidEarnings},
          NOW()
        )
      `;

      await prisma.resellerProfile.update({
        where: { user_id: ancestor.user_id },
        data: {
          left_points: leftPts,
          right_points: rightPts,
          daily_pairing_count: isToday ? { increment: paidPairs } : paidPairs, // fresh count on new day
          daily_pairing_date: today,
        },
      });
    } else {
      // No pair yet — just accumulate points (carry over)
      await prisma.resellerProfile.update({
        where: { user_id: ancestor.user_id },
        data: { left_points: leftPts, right_points: rightPts },
      });
    }

    // Move up — update leg for next ancestor
    currentLeg = (ancestor.position as "left" | "right") || currentLeg;
  }
}

// ============================================================
// POST — register new reseller
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "city") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      full_name,
      email,
      mobile,
      password,
      address,
      zip_code,
      street_address,
      region_code,
      region_name,
      province_code,
      province_name,
      city_muni_code,
      city_muni_name,
      barangay_code,
      barangay_name,
      first_name,
      middle_name,
      last_name,
      suffix,
      no_middle_name,
      birthday,
      birthplace,
      identity_document_type,
      identity_document_number,
      identity_confirmation,
      pin_id,
      referrer_username,
      actual_parent_node_id,
      actual_position,
    } = await req.json();

    if (
      !full_name ||
      !mobile ||
      !password ||
      !pin_id ||
      !referrer_username ||
      !actual_parent_node_id ||
      !actual_position
    ) {
      return NextResponse.json(
        { error: "All required fields must be filled." },
        { status: 400 },
      );
    }
    if (!birthday || !birthplace) {
      return NextResponse.json(
        { error: "Date of birth and place of birth are required." },
        { status: 400 },
      );
    }
    try {
      validateIdentityDocument(
        String(identity_document_type || ""),
        String(identity_document_number || ""),
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Valid ID is required.",
        },
        { status: 400 },
      );
    }

    if (!email || !address?.trim() || !/^\d{4}$/.test(String(zip_code || ""))) {
      return NextResponse.json(
        {
          error:
            "Email, complete street address, and a valid 4-digit ZIP code are required.",
        },
        { status: 400 },
      );
    }
    if (
      !street_address?.trim() ||
      !region_code ||
      !region_name ||
      !city_muni_code ||
      !city_muni_name ||
      !barangay_code ||
      !barangay_name
    ) {
      return NextResponse.json(
        {
          error:
            "Please select a complete Region, City/Municipality, and Barangay, then enter the street address.",
        },
        { status: 400 },
      );
    }

    const cleanFirstName = normalizePersonName(String(first_name || ""));
    const cleanMiddleName = normalizePersonName(String(middle_name || ""));
    const cleanLastName = normalizePersonName(String(last_name || ""));
    const cleanSuffix = String(suffix || "").trim();

    if (!cleanFirstName || !cleanLastName) {
      return NextResponse.json(
        { error: "First name and last name are required." },
        { status: 400 },
      );
    }
    if (no_middle_name !== true && !cleanMiddleName) {
      return NextResponse.json(
        {
          error:
            "Middle name is required unless the member legally has no middle name.",
        },
        { status: 400 },
      );
    }
    if (cleanSuffix && !isPersonSuffix(cleanSuffix)) {
      return NextResponse.json(
        { error: "Invalid name suffix." },
        { status: 400 },
      );
    }

    const cleanFullName = buildPersonName({
      firstName: cleanFirstName,
      middleName: no_middle_name === true ? "" : cleanMiddleName,
      lastName: cleanLastName,
      suffix: cleanSuffix,
    });

    if (!hasCompletePersonName(cleanFullName)) {
      return NextResponse.json(
        { error: "A valid first name and last name are required." },
        { status: 400 },
      );
    }

    if (!["left", "right"].includes(actual_position)) {
      return NextResponse.json({ error: "Invalid position." }, { status: 400 });
    }

    const candidatePlan = await generateUsernamePlan({
      fullName: cleanFullName,
      birthday: String(birthday),
      birthplace: String(birthplace),
      identityDocumentType: String(identity_document_type),
      identityDocumentNumber: String(identity_document_number),
      mobile: String(mobile),
      email: String(email),
    });
    if (
      candidatePlan.confirmationRequired &&
      identity_confirmation !== "same" &&
      identity_confirmation !== "different"
    ) {
      return NextResponse.json(
        {
          error:
            "Please confirm whether this is the same person before registering.",
          matching_usernames: candidatePlan.matchingUsernames,
        },
        { status: 409 },
      );
    }
    const usernamePlan = await generateUsernamePlan({
      fullName: cleanFullName,
      birthday: String(birthday),
      birthplace: String(birthplace),
      identityDocumentType: String(identity_document_type),
      identityDocumentNumber: String(identity_document_number),
      mobile: String(mobile),
      email: String(email),
      identityConfirmation:
        identity_confirmation === "same" ||
        identity_confirmation === "different"
          ? identity_confirmation
          : undefined,
    });
    const identityDocumentHash = hashIdentityDocument(
      String(identity_document_type),
      String(identity_document_number),
    );
    const cleanUsername = usernamePlan.username;
    const [existingUser, pin, slotTaken, parentNodeExists, referrer] =
      await Promise.all([
        prisma.user.findUnique({ where: { username: cleanUsername } }),
        prisma.pin.findUnique({
          where: { id: pin_id },
          select: {
            id: true,
            pin_code: true,
            status: true,
            pin_type: true,
            package_id: true,
            city_dist_id: true,
          },
        }),
        prisma.binaryTreeNode.findFirst({
          where: {
            parent_id: actual_parent_node_id,
            position: actual_position,
          },
        }),
        prisma.binaryTreeNode.findUnique({
          where: { id: actual_parent_node_id },
        }),
        prisma.user.findUnique({
          where: { username: referrer_username.trim().toLowerCase() },
          select: { id: true, username: true, role: true, status: true },
        }),
      ]);

    if (existingUser)
      return NextResponse.json(
        { error: "Username already taken." },
        { status: 400 },
      );
    if (!pin || pin.status !== "unused")
      return NextResponse.json(
        { error: "PIN is invalid or already used." },
        { status: 400 },
      );
    if (pin.pin_type !== "registration")
      return NextResponse.json(
        { error: "A registration PIN is required for a new account." },
        { status: 400 },
      );
    if (pin.city_dist_id !== user.id)
      return NextResponse.json(
        { error: "This PIN does not belong to your account." },
        { status: 400 },
      );
    if (slotTaken)
      return NextResponse.json(
        { error: "This slot was just taken. Please refresh and try again." },
        { status: 400 },
      );
    if (!parentNodeExists)
      return NextResponse.json(
        { error: "Parent node not found." },
        { status: 400 },
      );
    if (!referrer)
      return NextResponse.json(
        { error: "Referrer not found." },
        { status: 400 },
      );

    // Block if referrer is deactivated (unless it's hiroma)
    if (referrer.username !== "hiroma" && referrer.status !== "active") {
      return NextResponse.json(
        {
          error:
            "The referrer account is not active. Please use an active referrer.",
        },
        { status: 400 },
      );
    }

    const effectiveCount = usernamePlan.existingAccountCount;
    const maxAllowed = usernamePlan.maxAccounts;

    if (effectiveCount >= maxAllowed) {
      return NextResponse.json(
        {
          error: `Maximum accounts (${maxAllowed}) reached for this person.`,
        },
        { status: 400 },
      );
    }
    const isHiromaNode = referrer.username === "hiroma";

    const referrerProfile = !isHiromaNode
      ? await prisma.resellerProfile.findUnique({
          where: { user_id: referrer.id },
          select: {
            daily_referral_count: true,
            last_referral_date: true,
            package: {
              select: {
                direct_referral_bonus: true,
                pairing_bonus_value: true,
                id: true,
              },
            },
          },
        })
      : null;

    let overflowToHiroma = false;
    if (!isHiromaNode && referrerProfile) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isToday = referrerProfile.last_referral_date
        ? new Date(referrerProfile.last_referral_date) >= today
        : false;
      const dailyCount = isToday ? referrerProfile.daily_referral_count : 0;
      const [capConfig] = await prisma.$queryRaw<
        { enabled: boolean; cap: number }[]
      >`
        SELECT COALESCE(direct_referral_cap_enabled, true) AS enabled,
               COALESCE(daily_referral_cap, 10)::int AS cap
        FROM packages
        WHERE id = ${referrerProfile.package.id}
      `;
      overflowToHiroma =
        Boolean(capConfig?.enabled) &&
        dailyCount >= Number(capConfig?.cap || 10);
    }

    const [packageProducts, registrationOwnerProfile] = await Promise.all([
      prisma.packageProduct.findMany({
        where: { package_id: pin.package_id },
        select: {
          product_id: true,
          quantity: true,
          product: {
            select: {
              name: true,
              price: true,
              cost_price: true,
              city_price: true,
              branch_price: true,
              reseller_price: true,
            },
          },
        },
      }),
      prisma.distributorProfile.findUnique({
        where: { user_id: user.id },
        select: { dist_level: true },
      }),
    ]);

    const packageProductIds = packageProducts.map((pp) => pp.product_id);
    const inventoryItems = await prisma.inventory.findMany({
      where: { owner_id: user.id, product_id: { in: packageProductIds } },
      select: { product_id: true, quantity: true },
    });
    const inventoryMap = new Map(
      inventoryItems.map((i) => [i.product_id, i.quantity]),
    );

    const stockErrors = packageProducts
      .filter((pp) => (inventoryMap.get(pp.product_id) ?? 0) < pp.quantity)
      .map(
        (pp) =>
          `"${pp.product.name}": need ${pp.quantity}, only ${inventoryMap.get(pp.product_id) ?? 0} in stock`,
      );

    if (stockErrors.length > 0) {
      return NextResponse.json(
        {
          error: `Insufficient inventory to complete registration:\n${stockErrors.join("\n")}`,
        },
        { status: 400 },
      );
    }

    const isBranchRegistration =
      registrationOwnerProfile?.dist_level === "branch";
    const registrationEconomics = packageProducts.reduce(
      (totals, item) => {
        const srp = Number(item.product.price || 0);
        const resellerPrice = Number(item.product.reseller_price) || srp;
        const acquisitionPrice = isBranchRegistration
          ? Number(item.product.branch_price) || Number(item.product.cost_price)
          : Number(item.product.city_price) || Number(item.product.cost_price);
        totals.customerPayment += srp * item.quantity;
        totals.resellerValue += resellerPrice * item.quantity;
        totals.acquisitionCost += acquisitionPrice * item.quantity;
        return totals;
      },
      { customerPayment: 0, resellerValue: 0, acquisitionCost: 0 },
    );
    const packageUnitsSnapshot = packageProducts.reduce((sum, item) => sum + item.quantity, 0);
    const registrationPinAllocation = Math.max(
      0,
      registrationEconomics.customerPayment -
        registrationEconomics.resellerValue,
    );
    const registrationProfit =
      registrationEconomics.resellerValue -
      registrationEconomics.acquisitionCost;
    const packageSnapshot = await prisma.package.findUnique({
      where: { id: pin.package_id },
      select: {
        name: true,
        direct_referral_bonus: true,
        pairing_bonus_value: true,
      },
    });
    if (!packageSnapshot)
      return NextResponse.json(
        { error: "Package configuration was not found." },
        { status: 400 },
      );

    const hashedPassword = await hashPassword(password);

    const registration = await prisma.$transaction(async (tx) => {
      await assertPlacementWithinReferrerSubtree(
        tx,
        referrer.id,
        actual_parent_node_id,
      );
      await claimUnusedPin(tx, pin.id);
      await claimIdentityAccountSlot(tx, identityDocumentHash);
      const memberId = await generateMemberId(tx);
      const created = await tx.user.create({
        data: {
          member_id: memberId,
          username: cleanUsername,
          full_name: cleanFullName,
          email: email?.trim().toLowerCase() || null,
          mobile: mobile.trim(),
          password_hash: hashedPassword,
          password_change_required: true,
          password_is_temporary: true,
          password_retention_stage: 0,
          password_prompt_due_at: new Date(),
          role: "reseller",
          status: "active",
          address: address?.trim() || null,
          zip_code: String(zip_code),
          street_address: street_address.trim(),
          region_code: String(region_code),
          region_name: String(region_name),
          province_code: province_code ? String(province_code) : null,
          province_name: province_name ? String(province_name) : null,
          city_muni_code: String(city_muni_code),
          city_muni_name: String(city_muni_name),
          barangay_code: String(barangay_code),
          barangay_name: String(barangay_name),
          created_by: user.id,
        },
      });

      // Save birthday + birthplace via raw SQL
      if (birthday && birthplace) {
        await tx.$executeRaw`
          UPDATE users
          SET birthday = ${new Date(birthday).toISOString().slice(0, 10)}::date,
              birthplace = ${birthplace.trim()},
              identity_document_type = ${String(identity_document_type)},
              identity_document_hash = ${identityDocumentHash}
          WHERE id::text = ${created.id}
        `;
      }

      await tx.resellerProfile.create({
        data: {
          user_id: created.id,
          package_id: pin.package_id,
          city_dist_id: user.id,
          pin_id: pin.id,
          total_points: 0,
          rank: "default",
          total_pu: 0,
          daily_referral_count: 0,
          daily_pairs_count: 0,
        },
      });

      await tx.wallet.create({
        data: {
          user_id: created.id,
          balance: 0,
          total_earned: 0,
          total_withdrawn: 0,
        },
      });

      const directReferral = isHiromaNode
        ? { capExceeded: false, payable: 0, flashout: 0 }
        : await settleDirectReferral(tx, {
            referrerId: referrer.id,
            newUserId: created.id,
            referredPackageId: pin.package_id,
            sourceEventId: pin.id,
          });

      await tx.binaryTreeNode.create({
        data: {
          user_id: created.id,
          parent_id: actual_parent_node_id,
          position: actual_position,
          // A capped bonus is still a valid direct referral. Keep the sponsor
          // relationship for genealogy/reporting; only the income flashes out.
          sponsor_id: referrer.id,
          left_count: 0,
          right_count: 0,
          is_overflow: directReferral.capExceeded,
        },
      });

      await tx.pin.update({
        where: { id: pin.id },
        data: { used_by: created.id },
      });

      await tx.registrationFinancial.create({
        data: {
          pin_id: pin.id,
          city_dist_id: user.id,
          reseller_id: created.id,
          package_id: pin.package_id,
          customer_payment: ledgerAmount(registrationEconomics.customerPayment),
          product_acquisition_cost: ledgerAmount(
            registrationEconomics.acquisitionCost,
          ),
          reseller_value: ledgerAmount(registrationEconomics.resellerValue),
          pin_allocation: ledgerAmount(registrationPinAllocation),
          registration_profit: ledgerAmount(registrationProfit),
          package_name_snapshot: packageSnapshot.name,
          package_units_snapshot: packageUnitsSnapshot,
          direct_referral_allocation: ledgerAmount(
            packageSnapshot.direct_referral_bonus,
          ),
          binary_commission_allocation:
            ledgerAmount(packageSnapshot.pairing_bonus_value) * 0.5,
          binary_points_per_pair: Math.round(
            ledgerAmount(packageSnapshot.pairing_bonus_value),
          ),
          binary_point_peso_rate: 0.5,
          registration_channel: "city",
          allocation_snapshot_source: "registration",
          payment_status: "paid",
          paid_at: new Date(),
        },
      });

      const binaryCommission = await settleBinaryCommission(tx, {
        sourceUserId: created.id,
        sourcePoints: Math.round(
          ledgerAmount(packageSnapshot.pairing_bonus_value),
        ),
        parentNodeId: actual_parent_node_id,
        position: actual_position as "left" | "right",
        sourceKind: "registration",
        sourceEventId: pin.id,
      });

      for (const item of packageProducts) {
        await tx.inventory.update({
          where: {
            owner_id_product_id: {
              owner_id: user.id,
              product_id: item.product_id,
            },
          },
          data: { quantity: { decrement: item.quantity } },
        });
      }

      await recordInventoryOutEvents(tx, {
        ownerId: user.id,
        actorId: user.id,
        actorName: user.full_name || user.username || "City Distributor",
        eventType: "registration_package_release",
        referenceType: "registration_pin",
        referenceId: pin.id,
        reason: `${packageSnapshot.name} products released for new reseller ${created.full_name}`,
        items: packageProducts.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_cost: isBranchRegistration
            ? Number(item.product.branch_price) || Number(item.product.cost_price)
            : Number(item.product.city_price) || Number(item.product.cost_price),
        })),
        metadata: { pin_code: pin.pin_code, reseller_id: created.id, package_id: pin.package_id },
      });

      await tx.nameCapRegistry.upsert({
        where: { normalized_name: usernamePlan.identityKey },
        update: { count: { increment: 1 } },
        create: {
          normalized_name: usernamePlan.identityKey,
          count: 1,
          max_allowed: 7,
        },
      });

      return { user: created, directReferral, binaryCommission };
    });
    const newUser = registration.user;

    // ── POST-TRANSACTION ──

    try {
      await updateAncestorCounts(
        actual_parent_node_id,
        actual_position as "left" | "right",
      );
    } catch (e) {
      console.error("[REGISTER] Ancestor count error:", e);
    }

    // Direct referral bonus — fires for everyone, but overflow goes to Hiroma if cap exceeded
    if (false && !isHiromaNode) {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isToday = referrerProfile?.last_referral_date
          ? new Date(referrerProfile.last_referral_date) >= today
          : false;

        const referrerBonus = Number(
          referrerProfile?.package?.direct_referral_bonus || 0,
        );
        const referredPkg = await prisma.package.findUnique({
          where: { id: pin.package_id },
          select: { direct_referral_bonus: true },
        });
        const referredBonus = Number(referredPkg?.direct_referral_bonus || 0);

        if (overflowToHiroma) {
          // Daily cap exceeded — entire referral bonus goes to Hiroma
          // source_user_id = referrer (who exceeded cap), so flushout page shows correct person
          const hiromaUser = await prisma.user.findFirst({
            where: { username: "hiroma" },
            select: { id: true },
          });
          // Once the sponsor has reached the daily cap, Hiroma retains the
          // new member package's full direct-referral value. This includes
          // both the sponsor-level amount and any higher-package difference.
          const totalBonus = referredBonus;
          if (totalBonus > 0 && hiromaUser) {
            await prisma.commission.create({
              data: {
                user_id: hiromaUser.id,
                type: "direct_referral",
                amount: totalBonus,
                source_user_id: referrer.id,
                is_pair_overflow: true,
                overflow_to: hiromaUser.id,
              },
            });
            await prisma.wallet.upsert({
              where: { user_id: hiromaUser.id },
              update: {
                balance: { increment: totalBonus },
                total_earned: { increment: totalBonus },
              },
              create: {
                user_id: hiromaUser.id,
                balance: totalBonus,
                total_earned: totalBonus,
                total_withdrawn: 0,
              },
            });
          }
        } else {
          // Normal — credit referrer, overflow to Hiroma if referred package is higher
          await prisma.resellerProfile.update({
            where: { user_id: referrer.id },
            data: {
              daily_referral_count: isToday ? { increment: 1 } : 1,
              last_referral_date: new Date(),
            },
          });
          await creditDirectReferralBonus(
            referrer.id,
            newUser.id,
            referrerBonus,
            referredBonus,
          );
        }
      } catch (e) {
        console.error("[REGISTER] Direct referral error:", e);
      }
    }

    // Binary pairing — ALWAYS fires regardless of referrer or overflow
    try {
      const pkg = await prisma.package.findUnique({
        where: { id: pin.package_id },
        select: { pairing_bonus_value: true },
      });
      const newUserPts = Number(pkg?.pairing_bonus_value || 0);
      if (false) {
        await firePointsPairingBonus(
          newUser.id,
          newUserPts,
          actual_parent_node_id,
          actual_position as "left" | "right",
        );
      }
    } catch (e) {
      console.error("[REGISTER] Binary pairing error FULL:", e);
      console.error(
        "[REGISTER] Binary pairing stack:",
        e instanceof Error ? e.stack : undefined,
      );
    }

    const packageWithProducts = await prisma.package.findUnique({
      where: { id: pin.package_id },
      select: {
        name: true,
        price: true,
        products: {
          select: {
            quantity: true,
            product: {
              select: {
                name: true,
                type: true,
                price: true,
                cost_price: true,
                city_price: true,
                branch_price: true,
                reseller_price: true,
              },
            },
          },
        },
      },
    });

    // ── Send welcome SMS ── (commented out to save SMS costs)
    // try {
    //   const smsMessage = smsWelcomeReseller({ full_name, username: username.trim().toLowerCase(), password, package_name: packageWithProducts?.name || 'Starter' })
    //   await sendSMS(mobile, smsMessage)
    // } catch (e) {
    //   console.error('[REGISTER] SMS error:', e)
    // }

    createAuditLog({
      user_id: user.actor_id || user.id,
      user_name: user.full_name || user.username,
      user_role: user.is_staff ? "staff" : user.role,
      member_id: formatMemberId(
        user.actor_id || user.id,
        user.is_staff ? "staff" : user.role,
      ),
      activity_type: "reseller_registered",
      category: "reseller",
      description: `New reseller registered: ${cleanFullName} (@${cleanUsername})`,
      metadata: {
        reseller_id: newUser.id,
        owner_id: user.id,
        performed_by_staff: Boolean(user.is_staff),
      },
      risk_level: "low",
      status: "normal",
    });

    return NextResponse.json({
      success: true,
      message: `${full_name} has been registered successfully.`,
      reseller: {
        id: newUser.id,
        full_name: cleanFullName,
        username: cleanUsername,
      },
      package: packageWithProducts
        ? (() => {
            const isBranch = registrationOwnerProfile?.dist_level === "branch";
            const productsTotal = packageWithProducts.products.reduce(
              (sum, p) => sum + Number(p.product.price || 0) * p.quantity,
              0,
            );
            const resellerValue = packageWithProducts.products.reduce(
              (sum, p) =>
                sum +
                (Number(p.product.reseller_price) || Number(p.product.price)) *
                  p.quantity,
              0,
            );
            const acquisitionCost = packageWithProducts.products.reduce(
              (sum, p) => {
                const unitCost = isBranch
                  ? Number(p.product.branch_price) ||
                    Number(p.product.cost_price)
                  : Number(p.product.city_price) ||
                    Number(p.product.cost_price);
                return sum + unitCost * p.quantity;
              },
              0,
            );
            const pinPrice = Math.max(0, productsTotal - resellerValue);
            return {
              name: packageWithProducts.name,
              pin_price: pinPrice,
              configured_pin_price: Number(packageWithProducts.price),
              products_total: productsTotal,
              reseller_value: resellerValue,
              acquisition_cost: acquisitionCost,
              registration_profit: resellerValue - acquisitionCost,
              total_price: productsTotal,
              products: packageWithProducts.products.map((p) => ({
                name: p.product.name,
                type: p.product.type,
                quantity: p.quantity,
                srp: Number(p.product.price || 0),
                subtotal: Number(p.product.price || 0) * p.quantity,
              })),
            };
          })()
        : null,
    });
  } catch (error: unknown) {
    if (error instanceof PinAlreadyClaimedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof InvalidBinaryTreePlacementError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isBinaryTreeSlotConflict(error)) {
      return NextResponse.json(
        {
          error:
            "The selected binary-tree slot was taken by another registration. Please choose another slot.",
        },
        { status: 409 },
      );
    }
    if (error instanceof IdentityAccountLimitError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(
      "[REGISTER RESELLER ERROR]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Registration failed. Please try again." },
      { status: 500 },
    );
  }
}
