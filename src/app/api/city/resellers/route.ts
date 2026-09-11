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
import {
  recordSystemDirectReferralRetention,
  settleDirectReferral,
} from "@/app/lib/directReferral";
import {
  DuplicateBinarySettlementError,
  InsufficientBinaryReserveError,
  settleBinaryCommission,
} from "@/app/lib/binaryCommission";
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
import {
  consumeAvailableStock,
  InsufficientStockError,
} from "@/app/lib/inventoryReservation";
import {
  parseRegistrationPinSnapshot,
  readIssuedRegistrationPinSnapshot,
  registrationPinSnapshotsMatch,
  RegistrationPinSnapshotError,
} from "@/app/lib/registrationPinSnapshot";
import {
  assertPosRegistrationNetworkBinding,
  PosRegistrationNetworkBindingError,
  readPosRegistrationNetworkSnapshot,
} from "@/app/lib/posRegistrationNetwork";
import {
  assertPosRegistrationApplicantBinding,
  isLikelyOutstandingPosApplicant,
  lockPosRegistrationApplicant,
  PosRegistrationApplicantBindingError,
  PosRegistrationHandoffRequiredError,
} from "@/app/lib/posRegistrationApplicant";
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

function ledgerAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
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
      pos_intake_id,
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
    const expectedPosApplicant = {
      fullName: cleanFullName,
      mobile: String(mobile),
      identityDocumentHash,
    };
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
            pin_allocation_snapshot: true,
            registration_package_name_snapshot: true,
            registration_customer_payment_snapshot: true,
            registration_reseller_value_snapshot: true,
            registration_acquisition_cost_snapshot: true,
            registration_acquisition_tier_snapshot: true,
            registration_direct_allocation_snapshot: true,
            registration_binary_allocation_snapshot: true,
            registration_points_snapshot: true,
            registration_product_line_count_snapshot: true,
            registration_units_snapshot: true,
            registration_product_snapshots: {
              select: {
                product_id: true,
                quantity: true,
                srp_snapshot: true,
                reseller_price_snapshot: true,
                unit_acquisition_cost_snapshot: true,
                product: { select: { name: true, type: true } },
              },
            },
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
          select: {
            id: true,
            user_id: true,
            user: { select: { username: true } },
          },
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
    const registrationSnapshot = readIssuedRegistrationPinSnapshot(pin);
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

    const posIntake = pos_intake_id
      ? await prisma.posRegistrationIntake.findFirst({
          where: {
            id: String(pos_intake_id),
            owner_id: user.id,
            package_id: pin.package_id,
            released_at: { not: null },
            completed_user_id: null,
            status: { in: ["released_pending_encoding", "encoding_in_progress"] },
          },
          select: {
            id: true,
            applicant_full_name: true,
            applicant_mobile: true,
            identity_document_hash: true,
            identity_document_type: true,
            identity_document_reference: true,
            amount_snapshot: true,
            registration_snapshot: true,
            pin_id: true,
            referrer_username: true,
            preferred_position: true,
            applicant_snapshot: true,
          },
        })
      : null;
    if (pos_intake_id && !posIntake) {
      return NextResponse.json(
        {
          error:
            "This POS registration handoff is invalid, incomplete, already encoded, or belongs to another package.",
        },
        { status: 409 },
      );
    }
    if (posIntake) {
      assertPosRegistrationApplicantBinding(posIntake, expectedPosApplicant);
    }

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

    const registrationOwnerProfile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true, is_active: true },
    });
    if (!registrationOwnerProfile?.is_active
      || registrationOwnerProfile.dist_level !== registrationSnapshot.acquisitionTier) {
      return NextResponse.json(
        { error: "The PIN's issued acquisition tier no longer matches this active outlet. Cancel and reissue the PIN." },
        { status: 409 },
      );
    }
    if (posIntake && parentNodeExists && referrer) {
      assertPosRegistrationNetworkBinding(
        readPosRegistrationNetworkSnapshot(posIntake),
        {
          referrerUserId: referrer.id,
          referrerUsername: referrer.username,
          parentNodeId: parentNodeExists.id,
          parentUsername: parentNodeExists.user.username,
          position: actual_position as "left" | "right",
        },
      );
    }
    if (posIntake) {
      const intakeSnapshot = parseRegistrationPinSnapshot(posIntake.registration_snapshot);
      if (!registrationPinSnapshotsMatch(intakeSnapshot, registrationSnapshot)
        || Number(posIntake.amount_snapshot) !== registrationSnapshot.customerPayment
        || (posIntake.pin_id && posIntake.pin_id !== pin.id)) {
        return NextResponse.json(
          { error: "The POS payment/product release does not exactly match this registration PIN." },
          { status: 409 },
        );
      }
    }
    const packageProducts = pin.registration_product_snapshots.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      product: {
        name: item.product.name,
        type: item.product.type,
        price: item.srp_snapshot,
        reseller_price: item.reseller_price_snapshot,
        cost_price: item.unit_acquisition_cost_snapshot,
        city_price: item.unit_acquisition_cost_snapshot,
        branch_price: item.unit_acquisition_cost_snapshot,
      },
    }));

    const packageProductIds = packageProducts.map((pp) => pp.product_id);
    const inventoryItems = await prisma.inventory.findMany({
      where: { owner_id: user.id, product_id: { in: packageProductIds } },
      select: { product_id: true, quantity: true, reserved_quantity: true },
    });
    const inventoryMap = new Map(
      inventoryItems.map((i) => [i.product_id, i.quantity - i.reserved_quantity]),
    );

    const stockErrors = packageProducts
      .filter((pp) => (inventoryMap.get(pp.product_id) ?? 0) < pp.quantity)
      .map(
        (pp) =>
          `"${pp.product.name}": need ${pp.quantity}, only ${inventoryMap.get(pp.product_id) ?? 0} in stock`,
      );

    if (!posIntake && stockErrors.length > 0) {
      return NextResponse.json(
        {
          error: `Insufficient inventory to complete registration:\n${stockErrors.join("\n")}`,
        },
        { status: 400 },
      );
    }

    const registrationEconomics = {
      customerPayment: registrationSnapshot.customerPayment,
      resellerValue: registrationSnapshot.resellerValue,
      acquisitionCost: registrationSnapshot.acquisitionCost,
    };
    const packageUnitsSnapshot = packageProducts.reduce((sum, item) => sum + item.quantity, 0);
    const registrationPinAllocation = registrationSnapshot.pinAllocation;
    const registrationProfit =
      registrationEconomics.resellerValue -
      registrationEconomics.acquisitionCost;
    const packageSnapshot = {
      name: registrationSnapshot.packageName,
      direct_referral_bonus: registrationSnapshot.directAllocation,
      pairing_bonus_value: registrationSnapshot.points,
    };

    const hashedPassword = await hashPassword(password);

    const registration = await prisma.$transaction(async (tx) => {
      await lockPosRegistrationApplicant(tx, identityDocumentHash);
      if (!posIntake) {
        const outstandingPaidIntakes =
          await tx.posRegistrationIntake.findMany({
            where: {
              owner_id: user.id,
              released_at: { not: null },
              completed_user_id: null,
              status: {
                in: ["released_pending_encoding", "encoding_in_progress"],
              },
              OR: [
                { identity_document_hash: identityDocumentHash },
                { applicant_mobile: String(mobile).trim() },
                // Legacy released intakes predate the indexed identity hash.
                { identity_document_hash: null },
              ],
            },
            select: {
              applicant_full_name: true,
              applicant_mobile: true,
              identity_document_hash: true,
              identity_document_type: true,
              identity_document_reference: true,
            },
          });
        if (
          outstandingPaidIntakes.some((intake) =>
            isLikelyOutstandingPosApplicant(intake, expectedPosApplicant),
          )
        ) {
          throw new PosRegistrationHandoffRequiredError();
        }
      }
      if (posIntake) {
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            completed_user_id: string | null;
            pin_id: string | null;
            amount_snapshot: unknown;
            registration_snapshot: unknown;
            referrer_username: string;
            preferred_position: string | null;
            applicant_snapshot: unknown;
            applicant_full_name: string;
            applicant_mobile: string;
            identity_document_hash: string | null;
            identity_document_type: string | null;
            identity_document_reference: string | null;
          }>
        >`SELECT id, status, completed_user_id, pin_id, amount_snapshot, registration_snapshot,
                 referrer_username, preferred_position, applicant_snapshot,
                 applicant_full_name, applicant_mobile, identity_document_hash,
                 identity_document_type, identity_document_reference
           FROM pos_registration_intakes
           WHERE id = ${posIntake.id}::uuid AND owner_id = ${user.id}
           FOR UPDATE`;
        if (
          !locked[0] ||
          locked[0].completed_user_id ||
          (locked[0].pin_id && locked[0].pin_id !== pin.id) ||
          Number(locked[0].amount_snapshot) !== registrationSnapshot.customerPayment ||
          !registrationPinSnapshotsMatch(
            parseRegistrationPinSnapshot(locked[0].registration_snapshot),
            registrationSnapshot,
          ) ||
          !["released_pending_encoding", "encoding_in_progress"].includes(
            locked[0].status,
          )
        ) {
          throw new Error("POS_REGISTRATION_ALREADY_ENCODED");
        }
        const [lockedReferrer, lockedParent] = await Promise.all([
          tx.user.findUnique({
            where: { id: referrer.id },
            select: { id: true, username: true, role: true, status: true },
          }),
          tx.binaryTreeNode.findUnique({
            where: { id: actual_parent_node_id },
            select: { id: true, user: { select: { username: true } } },
          }),
        ]);
        if (
          !lockedReferrer ||
          !lockedParent ||
          lockedReferrer.status !== "active" ||
          (lockedReferrer.role !== "reseller" && lockedReferrer.username !== "hiroma")
        ) throw new PosRegistrationNetworkBindingError();
        assertPosRegistrationNetworkBinding(
          readPosRegistrationNetworkSnapshot(locked[0]),
          {
            referrerUserId: lockedReferrer.id,
            referrerUsername: lockedReferrer.username,
            parentNodeId: lockedParent.id,
            parentUsername: lockedParent.user.username,
            position: actual_position as "left" | "right",
          },
        );
        assertPosRegistrationApplicantBinding(
          locked[0],
          expectedPosApplicant,
        );
        if (locked[0].status === "released_pending_encoding") {
          await tx.posRegistrationIntake.update({
            where: { id: posIntake.id },
            data: {
              status: "encoding_in_progress",
              encoding_started_at: new Date(),
              encoder_id: user.actor_id || user.id,
              pin_id: pin.id,
            },
          });
          await tx.posRegistrationEvent.create({
            data: {
              intake_id: posIntake.id,
              actor_id: user.actor_id || user.id,
              from_status: "released_pending_encoding",
              to_status: "encoding_in_progress",
              action: "encoding_started",
              metadata: { pin_id: pin.id },
            },
          });
        }
      }
      await assertPlacementWithinReferrerSubtree(
        tx,
        referrer.id,
        actual_parent_node_id,
      );
      await claimIdentityAccountSlot(tx, identityDocumentHash);
      const memberId = await generateMemberId(tx);
      const created = await tx.user.create({
        data: {
          member_id: memberId,
          username: cleanUsername,
          full_name: cleanFullName,
          first_name: cleanFirstName,
          middle_name: no_middle_name === true ? null : cleanMiddleName,
          last_name: cleanLastName,
          name_suffix: cleanSuffix || null,
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
      await claimUnusedPin(tx, pin.id, created.id);

      // Persist the exact paid economics first. Direct and Binary commission
      // triggers will refuse a credit without this source funding record.
      await tx.registrationFinancial.create({
        data: {
          pin_id: pin.id,
          city_dist_id: user.id,
          reseller_id: created.id,
          package_id: pin.package_id,
          customer_payment: ledgerAmount(registrationEconomics.customerPayment),
          product_acquisition_cost: ledgerAmount(registrationEconomics.acquisitionCost),
          reseller_value: ledgerAmount(registrationEconomics.resellerValue),
          pin_allocation: ledgerAmount(registrationPinAllocation),
          registration_profit: ledgerAmount(registrationProfit),
          package_name_snapshot: packageSnapshot.name,
          package_units_snapshot: packageUnitsSnapshot,
          direct_referral_allocation: ledgerAmount(packageSnapshot.direct_referral_bonus),
          binary_commission_allocation: registrationSnapshot.binaryAllocation,
          binary_points_per_pair: Math.round(ledgerAmount(packageSnapshot.pairing_bonus_value)),
          binary_point_peso_rate: 0.5,
          registration_channel: registrationSnapshot.acquisitionTier,
          allocation_snapshot_source: "registration",
          payment_status: "paid",
          paid_at: new Date(),
        },
      });

      const directReferral = isHiromaNode
        ? await recordSystemDirectReferralRetention(tx, {
            referrerId: referrer.id,
            newUserId: created.id,
            referredDirectAllocation: registrationSnapshot.directAllocation,
            sourceEventId: pin.id,
          })
        : await settleDirectReferral(tx, {
            referrerId: referrer.id,
            newUserId: created.id,
            referredDirectAllocation: registrationSnapshot.directAllocation,
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
      // Database trigger `binary_tree_nodes_maintain_ancestor_counts` updates
      // every ancestor in this same transaction. Keeping this at the database
      // boundary makes all placement writers atomic and prevents a committed
      // node from being omitted from the derived dashboard counters.

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

      if (!posIntake) {
        await consumeAvailableStock(
          tx,
          user.id,
          packageProducts.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
          })),
        );

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
            unit_cost: Number(item.product.cost_price),
          })),
          metadata: { pin_code: pin.pin_code, reseller_id: created.id, package_id: pin.package_id },
        });
      } else {
        await tx.posRegistrationIntake.update({
          where: { id: posIntake.id },
          data: {
            status: "registration_completed",
            completed_at: new Date(),
            completed_user_id: created.id,
            encoder_id: user.actor_id || user.id,
            pin_id: pin.id,
          },
        });
        await tx.posRegistrationEvent.create({
          data: {
            intake_id: posIntake.id,
            actor_id: user.actor_id || user.id,
            from_status: "encoding_in_progress",
            to_status: "registration_completed",
            action: "registration_completed",
            metadata: { reseller_id: created.id, pin_id: pin.id },
          },
        });
      }

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

    const packageWithProducts = {
      name: registrationSnapshot.packageName,
      price: registrationSnapshot.pinAllocation,
      products: packageProducts,
    };

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
            const isBranch = registrationSnapshot.acquisitionTier === "branch";
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
    if (
      error instanceof Error &&
      error.message === "POS_REGISTRATION_ALREADY_ENCODED"
    ) {
      return NextResponse.json(
        {
          error:
            "This POS registration was already completed or is being encoded in another session.",
        },
        { status: 409 },
      );
    }
    if (error instanceof PinAlreadyClaimedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof InvalidBinaryTreePlacementError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof PosRegistrationNetworkBindingError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof PosRegistrationApplicantBindingError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof PosRegistrationHandoffRequiredError) {
      return NextResponse.json(
        { error: error.message, code: "POS_REGISTRATION_HANDOFF_REQUIRED" },
        { status: 409 },
      );
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
    if (error instanceof RegistrationPinSnapshotError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: "Available inventory changed during registration. Refresh stock and try again." },
        { status: 409 },
      );
    }
    if (
      error instanceof InsufficientBinaryReserveError ||
      error instanceof DuplicateBinarySettlementError
    ) {
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
