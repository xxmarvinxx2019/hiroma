import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/app/lib/auth";
import prisma from "@/app/lib/prisma";
import { releasePosRegistrationPackage } from "@/app/lib/posRegistration";
import { InsufficientStockError } from "@/app/lib/inventoryReservation";
import { hashIdentityDocument } from "@/app/lib/identityDocument";
import { notifyPosReviewers } from "@/app/lib/posNotifications";
import {
  createRequiredAuditLog,
  formatMemberId,
  getClientInfo,
} from "@/app/lib/auditLog";
import {
  buildRegistrationPinSnapshot,
  RegistrationPinSnapshotError,
  type RegistrationAcquisitionTier,
} from "@/app/lib/registrationPinSnapshot";
import {
  assertPlacementWithinReferrerSubtree,
  InvalidBinaryTreePlacementError,
} from "@/app/lib/binaryTreePlacement";
import { lockPosRegistrationApplicant } from "@/app/lib/posRegistrationApplicant";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT = /^HRM-[A-Z0-9]{3}-[A-F0-9]{7}-[0-9]{6}-[0-9]{6,}$/;

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function objectValue(value: unknown, key: string, max = 180) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean((value as Record<string, unknown>)[key], max);
}

function responseRow(row: {
  id: string;
  client_intake_id: string;
  receipt_number: string;
  status: string;
  applicant_full_name: string;
  applicant_mobile: string;
  applicant_email: string | null;
  applicant_birthday: Date;
  applicant_birthplace: string;
  applicant_address: unknown;
  applicant_snapshot: unknown;
  identity_document_type: string;
  identity_document_reference: string;
  referrer_username: string;
  preferred_position: string | null;
  payment_method_snapshot: string;
  payment_reference: string | null;
  amount_snapshot: Prisma.Decimal;
  captured_offline: boolean;
  payment_verified_at: Date | null;
  released_at: Date | null;
  encoding_started_at: Date | null;
  completed_at: Date | null;
  exception_reason: string | null;
  local_created_at: Date;
  package: { id: string; name: string };
  cashier: { full_name: string; username: string };
}) {
  return { ...row, amount: Number(row.amount_snapshot) };
}

const selection = {
  id: true,
  client_intake_id: true,
  receipt_number: true,
  status: true,
  applicant_full_name: true,
  applicant_mobile: true,
  applicant_email: true,
  applicant_birthday: true,
  applicant_birthplace: true,
  applicant_address: true,
  applicant_snapshot: true,
  identity_document_type: true,
  identity_document_reference: true,
  referrer_username: true,
  preferred_position: true,
  payment_method_snapshot: true,
  payment_reference: true,
  amount_snapshot: true,
  captured_offline: true,
  payment_verified_at: true,
  released_at: true,
  encoding_started_at: true,
  completed_at: true,
  exception_reason: true,
  local_created_at: true,
  package: { select: { id: true, name: true } },
  cashier: { select: { full_name: true, username: true } },
} satisfies Prisma.PosRegistrationIntakeSelect;

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "city")
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const actorId = user.actor_id || user.id;
  const rows = await prisma.posRegistrationIntake.findMany({
    where: user.is_staff
      ? { owner_id: user.id, cashier_id: actorId }
      : { owner_id: user.id },
    orderBy: { created_at: "desc" },
    take: 100,
    select: selection,
  });
  return NextResponse.json({ registrations: rows.map(responseRow) });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "city")
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const actorId = user.actor_id || user.id;
  try {
    const body = await req.json();
    const intakeId = clean(body.id, 36);
    const paymentReference = clean(body.payment_reference, 160);
    if (!UUID.test(intakeId) || paymentReference.length < 3) {
      return NextResponse.json(
        { error: "Enter the corrected official payment reference." },
        { status: 400 },
      );
    }

    const registration = await prisma.$transaction(
      async (tx) => {
        const intake = await tx.posRegistrationIntake.findFirst({
          where: {
            id: intakeId,
            owner_id: user.id,
            cashier_id: actorId,
            status: "needs_correction",
          },
          select: {
            id: true,
            receipt_number: true,
            applicant_full_name: true,
          },
        });
        if (!intake) throw new Error("POS_REGISTRATION_CORRECTION_STALE");

        const claimed = await tx.posRegistrationIntake.updateMany({
          where: { id: intake.id, status: "needs_correction" },
          data: {
            status: "pending_payment_verification",
            payment_reference: paymentReference,
            payment_verified_at: null,
            approver_id: null,
            exception_reason: null,
          },
        });
        if (claimed.count !== 1)
          throw new Error("POS_REGISTRATION_CORRECTION_STALE");

        await tx.posRegistrationEvent.create({
          data: {
            intake_id: intake.id,
            actor_id: actorId,
            from_status: "needs_correction",
            to_status: "pending_payment_verification",
            action: "payment_correction_resubmitted",
            metadata: { cashier_id: actorId },
          },
        });

        const client = getClientInfo(req);
        await createRequiredAuditLog(tx, {
          user_id: actorId,
          user_name: user.actor_name || user.full_name || user.username,
          user_role: user.is_staff ? "staff" : user.role,
          member_id: formatMemberId(
            actorId,
            user.is_staff ? "staff" : user.role,
          ),
          activity_type: "pos_registration_payment_correction_resubmitted",
          category: "order",
          description: `${intake.receipt_number} payment reference was corrected and resubmitted for independent review.`,
          metadata: {
            pos_registration_id: intake.id,
            cashier_id: actorId,
          },
          ...client,
          status: "completed",
        });
        return intake;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20_000,
      },
    );

    await notifyPosReviewers({
      ownerId: user.id,
      actorId,
      permission: "pos_approve",
      type: "pos_registration_correction_resubmitted",
      title: "Corrected registration payment needs review",
      message: `${registration.applicant_full_name}'s corrected payment is ready for another review. Receipt ${registration.receipt_number}.`,
      entityType: "pos_registration",
      entityId: registration.id,
      actionUrl: "/dashboard/city/pos/approvals",
    });

    return NextResponse.json({
      success: true,
      status: "pending_payment_verification",
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error:
            "That payment reference is already used. Check the official receipt and enter the correct unique reference.",
        },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      error.message === "POS_REGISTRATION_CORRECTION_STALE"
    ) {
      return NextResponse.json(
        {
          error:
            "This registration is no longer waiting for your correction. Refresh the registration list.",
        },
        { status: 409 },
      );
    }
    console.error("[POS REGISTRATION CORRECTION]", error);
    return NextResponse.json(
      { error: "The corrected registration could not be resubmitted safely." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "city")
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const actorId = user.actor_id || user.id;
  let replayClientIntakeId = "";
  try {
    const body = await req.json();
    const clientIntakeId = clean(body.client_intake_id, 36);
    replayClientIntakeId = clientIntakeId;
    const receiptNumber = clean(body.receipt_number, 80).toUpperCase();
    const terminalId = clean(body.terminal_id, 36);
    const shiftId = clean(body.shift_id, 36);
    const packageId = clean(body.package_id, 100);
    const firstName = clean(body.applicant?.first_name, 80);
    const noMiddleName = body.applicant?.no_middle_name === true;
    const middleName = noMiddleName
      ? ""
      : clean(body.applicant?.middle_name, 80);
    const lastName = clean(body.applicant?.last_name, 80);
    const suffix = clean(body.applicant?.suffix, 30);
    const fullName = [firstName, middleName, lastName, suffix]
      .filter(Boolean)
      .join(" ")
      .slice(0, 180);
    const mobile = clean(body.applicant?.mobile, 40);
    const email = clean(body.applicant?.email, 180).toLowerCase() || null;
    const birthday = new Date(body.applicant?.birthday);
    const birthplace = clean(body.applicant?.birthplace, 240);
    const referrerUsername = clean(
      body.applicant?.referrer_username,
      120,
    ).toLowerCase();
    const referrerFullName = clean(body.applicant?.referrer_full_name, 180);
    const uplineUsername = clean(
      body.applicant?.upline_username,
      120,
    ).toLowerCase();
    const uplineFullName = clean(body.applicant?.upline_full_name, 180);
    const preferredPosition = ["left", "right"].includes(
      body.applicant?.preferred_position,
    )
      ? body.applicant.preferred_position
      : null;
    const address = body.applicant?.address;
    const identityDocumentType = clean(
      body.applicant?.identity_document_type,
      80,
    );
    const identityDocumentReference = clean(
      body.applicant?.identity_document_reference,
      180,
    );
    const paymentSelection = clean(body.payment_method, 120);
    const paymentReference = clean(body.payment_reference, 160) || null;
    const capturedOffline = body.captured_offline === true;
    const localCreatedAt = new Date(body.local_created_at);
    const packageReleaseVerification = Array.isArray(
      body.package_release_verification,
    )
      ? body.package_release_verification
      : [];

    if (
      !UUID.test(clientIntakeId) ||
      !UUID.test(terminalId) ||
      !UUID.test(shiftId) ||
      !RECEIPT.test(receiptNumber) ||
      !packageId ||
      !firstName ||
      (!noMiddleName && !middleName) ||
      !lastName ||
      !fullName ||
      !mobile ||
      !email ||
      Number.isNaN(birthday.getTime()) ||
      !birthplace ||
      !referrerFullName ||
      !referrerUsername ||
      !uplineFullName ||
      !uplineUsername ||
      !preferredPosition ||
      !identityDocumentType ||
      !identityDocumentReference ||
      !address ||
      typeof address !== "object" ||
      !objectValue(address, "street_address", 240) ||
      !objectValue(address, "barangay_name") ||
      !objectValue(address, "city_muni_name") ||
      !objectValue(address, "province_name") ||
      !objectValue(address, "region_name") ||
      !objectValue(address, "zip_code", 20) ||
      !paymentSelection ||
      Number.isNaN(localCreatedAt.getTime())
    ) {
      return NextResponse.json(
        {
          error:
            "Complete all required applicant, package, payment, terminal, and receipt details.",
        },
        { status: 400 },
      );
    }
    if (capturedOffline && paymentSelection !== "cash") {
      return NextResponse.json(
        {
          error: "Offline registration accepts cash only.",
          code: "OFFLINE_CASH_ONLY",
        },
        { status: 400 },
      );
    }
    let identityDocumentHash = "";
    try {
      identityDocumentHash = hashIdentityDocument(
        identityDocumentType,
        identityDocumentReference,
      );
    } catch (reason) {
      return NextResponse.json(
        {
          error:
            reason instanceof Error
              ? reason.message
              : "Select a valid ID and enter its ID number.",
        },
        { status: 400 },
      );
    }

    const existing = await prisma.posRegistrationIntake.findFirst({
      where: {
        client_intake_id: clientIntakeId,
        owner_id: user.id,
        ...(user.is_staff ? { cashier_id: actorId } : {}),
      },
      select: selection,
    });
    if (existing)
      return NextResponse.json({
        registration: responseRow(existing),
        replayed: true,
      });

    const registration = await prisma.$transaction(
      async (tx) => {
        await lockPosRegistrationApplicant(tx, identityDocumentHash);
        const [terminal, shift, packageRow, ownerProfile, referrer, upline] = await Promise.all([
          tx.posTerminal.findFirst({
            where: { id: terminalId, owner_id: user.id, is_active: true },
            select: { id: true },
          }),
          tx.posShift.findFirst({
            where: {
              id: shiftId,
              terminal_id: terminalId,
              owner_id: user.id,
              opened_by_id: actorId,
              status: "open",
            },
            select: { id: true },
          }),
          tx.package.findFirst({
            where: { id: packageId, is_active: true },
            select: {
              id: true,
              name: true,
              price: true,
              direct_referral_bonus: true,
              pairing_bonus_value: true,
              products: {
                select: {
                  product_id: true,
                  quantity: true,
                  product: {
                    select: {
                      id: true,
                      name: true,
                      price: true,
                      reseller_price: true,
                      city_price: true,
                      branch_price: true,
                      cost_price: true,
                    },
                  },
                },
              },
            },
          }),
          tx.distributorProfile.findUnique({
            where: { user_id: user.id },
            select: { dist_level: true, is_active: true },
          }),
          tx.user.findUnique({
            where: { username: referrerUsername },
            select: { id: true, username: true, role: true, status: true },
          }),
          tx.user.findUnique({
            where: { username: uplineUsername },
            select: {
              id: true,
              username: true,
              binary_tree_node: { select: { id: true } },
            },
          }),
        ]);
        if (!terminal) throw new Error("POS_TERMINAL_INVALID");
        if (!shift) throw new Error("POS_SHIFT_INVALID");
        if (!packageRow || packageRow.products.length === 0)
          throw new Error("POS_PACKAGE_INVALID");
        const acquisitionTier: RegistrationAcquisitionTier | null =
          ownerProfile?.is_active
            && (ownerProfile.dist_level === "city" || ownerProfile.dist_level === "branch")
            ? ownerProfile.dist_level
            : null;
        if (!acquisitionTier) throw new Error("POS_OUTLET_INVALID");
        if (
          !referrer ||
          referrer.status !== "active" ||
          (referrer.role !== "reseller" && referrer.username !== "hiroma")
        ) throw new Error("POS_REFERRER_INVALID");
        if (!upline?.binary_tree_node) throw new Error("POS_UPLINE_INVALID");
        await assertPlacementWithinReferrerSubtree(
          tx,
          referrer.id,
          upline.binary_tree_node.id,
        );
        const occupiedSlot = await tx.binaryTreeNode.findFirst({
          where: {
            parent_id: upline.binary_tree_node.id,
            position: preferredPosition,
          },
          select: { id: true },
        });
        if (occupiedSlot) throw new Error("POS_SLOT_UNAVAILABLE");
        const registrationSnapshot = buildRegistrationPinSnapshot({
          packageId: packageRow.id,
          packageName: packageRow.name,
          configuredPinPrice: packageRow.price,
          directAllocation: packageRow.direct_referral_bonus,
          points: packageRow.pairing_bonus_value,
          acquisitionTier,
          products: packageRow.products,
        });
        const verificationByProduct = new Map<
          string,
          Record<string, unknown>
        >();
        for (const entry of packageReleaseVerification) {
          if (!entry || typeof entry !== "object" || Array.isArray(entry))
            continue;
          const value = entry as Record<string, unknown>;
          const productId = clean(value.product_id, 100);
          if (productId) verificationByProduct.set(productId, value);
        }
        const releaseVerified =
          verificationByProduct.size === packageRow.products.length &&
          packageRow.products.every((item) => {
            const verification = verificationByProduct.get(item.product.id);
            return (
              verification?.verified === true &&
              Number(verification.quantity) === item.quantity
            );
          });
        if (!releaseVerified) throw new Error("POS_PACKAGE_RELEASE_UNVERIFIED");

        const verifiedPackageContents = packageRow.products.map((item) => ({
          product_id: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          verified: true,
        }));

        let paymentMethodId: string | null = null;
        let paymentMethodSnapshot = "Cash";
        if (paymentSelection !== "cash") {
          const payment = await tx.paymentMethod.findFirst({
            where: {
              id: paymentSelection,
              user_id: user.id,
              status: "approved",
            },
            select: {
              type: true,
              account_name: true,
              account_number: true,
              bank_name: true,
            },
          });
          if (!payment) throw new Error("POS_PAYMENT_INVALID");
          if (!paymentReference)
            throw new Error("POS_PAYMENT_REFERENCE_REQUIRED");
          paymentMethodId = paymentSelection;
          paymentMethodSnapshot =
            `${payment.type.toUpperCase()} · ${payment.account_name} · ${payment.account_number}${payment.bank_name ? ` · ${payment.bank_name}` : ""}`.slice(
              0,
              160,
            );
        }
        const amount = registrationSnapshot.customerPayment;
        const initialStatus =
          paymentSelection === "cash"
            ? "draft_intake"
            : "pending_payment_verification";
        const created = await tx.posRegistrationIntake.create({
          data: {
            client_intake_id: clientIntakeId,
            receipt_number: receiptNumber,
            owner_id: user.id,
            terminal_id: terminalId,
            shift_id: shiftId,
            cashier_id: actorId,
            package_id: packageId,
            payment_method_id: paymentMethodId,
            status: initialStatus,
            applicant_full_name: fullName,
            applicant_mobile: mobile,
            applicant_email: email,
            applicant_birthday: birthday,
            applicant_birthplace: birthplace,
            applicant_address: address,
            identity_document_type: identityDocumentType,
            identity_document_reference: identityDocumentReference,
            identity_document_hash: identityDocumentHash,
            referrer_username: referrerUsername,
            preferred_position: preferredPosition,
            applicant_snapshot: {
              ...body.applicant,
              first_name: firstName,
              middle_name: middleName,
              last_name: lastName,
              suffix,
              no_middle_name: noMiddleName,
              full_name: fullName,
              referrer_full_name: referrerFullName,
              referrer_username: referrerUsername,
              referrer_user_id: referrer.id,
              upline_full_name: uplineFullName,
              upline_username: uplineUsername,
              parent_node_id: upline.binary_tree_node.id,
              preferred_position: preferredPosition,
              package_release_verification: verifiedPackageContents,
              identity_document_hash: identityDocumentHash,
            },
            payment_method_snapshot: paymentMethodSnapshot,
            payment_reference: paymentReference,
            payment_proof_url: clean(body.payment_proof_url, 500) || null,
            amount_snapshot: amount,
            registration_snapshot: registrationSnapshot as unknown as Prisma.InputJsonValue,
            captured_offline: capturedOffline,
            notes: clean(body.notes, 1000) || null,
            local_created_at: localCreatedAt,
            events: {
              create: {
                actor_id: actorId,
                to_status: initialStatus,
                action: "intake_created",
                metadata: {
                  captured_offline: capturedOffline,
                  receipt_number: receiptNumber,
                  package_release_verification: verifiedPackageContents,
                },
              },
            },
          },
          select: { id: true },
        });
        if (paymentSelection === "cash") {
          await releasePosRegistrationPackage(tx, {
            intakeId: created.id,
            ownerId: user.id,
            actorId,
            actorName: user.actor_name || user.full_name || user.username,
          });
        }
        return tx.posRegistrationIntake.findUniqueOrThrow({
          where: { id: created.id },
          select: selection,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const registrationRow = responseRow(registration);
    if (registration.status === "pending_payment_verification") {
      await notifyPosReviewers({
        ownerId: user.id,
        actorId,
        permission: "pos_approve",
        type: "pos_registration_payment_pending",
        title: "Registration payment needs review",
        message: `${registration.applicant_full_name}'s registration payment is waiting for verification. Receipt ${registration.receipt_number}.`,
        entityType: "pos_registration",
        entityId: registration.id,
        actionUrl: "/dashboard/city/pos/approvals",
      });
    } else if (registration.status === "released_pending_encoding") {
      await notifyPosReviewers({
        ownerId: user.id,
        actorId,
        permission: "register_reseller",
        type: "pos_registration_ready_for_encoding",
        title: "Reseller account ready for encoding",
        message: `${registration.applicant_full_name}'s paid registration is ready for final account creation. Receipt ${registration.receipt_number}.`,
        entityType: "pos_registration",
        entityId: registration.id,
        actionUrl: "/dashboard/city/pos/registrations",
      });
    }

    return NextResponse.json(
      { registration: registrationRow },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return NextResponse.json(
        {
          error:
            "The registration package cannot be released because one or more products no longer have enough stock.",
        },
        { status: 409 },
      );
    }
    if (error instanceof RegistrationPinSnapshotError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof InvalidBinaryTreePlacementError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      replayClientIntakeId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.posRegistrationIntake.findFirst({
        where: {
          client_intake_id: replayClientIntakeId,
          owner_id: user.id,
          ...(user.is_staff ? { cashier_id: actorId } : {}),
        },
        select: selection,
      });
      if (existing) {
        return NextResponse.json({
          registration: responseRow(existing),
          replayed: true,
        });
      }
    }
    const message = error instanceof Error ? error.message : "";
    const known: Record<string, string> = {
      POS_TERMINAL_INVALID: "This POS terminal is invalid or inactive.",
      POS_SHIFT_INVALID:
        "Open a valid cashier shift before accepting a registration.",
      POS_PACKAGE_INVALID: "The selected registration package is unavailable.",
      POS_OUTLET_INVALID: "The City/Branch outlet is inactive or has an invalid pricing tier.",
      POS_REFERRER_INVALID: "The selected sponsor is missing, inactive, or not eligible to sponsor a reseller.",
      POS_UPLINE_INVALID: "The selected upline does not have a valid binary-tree position.",
      POS_SLOT_UNAVAILABLE: "The selected upline leg is already occupied. Refresh the placement before accepting payment.",
      POS_PACKAGE_RELEASE_UNVERIFIED:
        "Verify every physical product and required quantity in the selected package before saving the registration.",
      POS_PAYMENT_INVALID: "The selected receiving account is unavailable.",
      POS_PAYMENT_REFERENCE_REQUIRED:
        "Enter the e-wallet or bank reference number.",
    };
    if (known[message])
      return NextResponse.json({ error: known[message] }, { status: 400 });
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "This receipt or payment reference was already recorded." },
        { status: 409 },
      );
    }
    console.error("[POS REGISTRATION CREATE]", error);
    return NextResponse.json(
      { error: "Unable to save this registration intake." },
      { status: 500 },
    );
  }
}
