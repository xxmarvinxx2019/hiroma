import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/app/lib/auth";
import prisma from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  DuplicateBinarySettlementError,
  InsufficientBinaryReserveError,
  settleBinaryCommission,
} from "@/app/lib/binaryCommission";
import { claimUnusedPin, PinAlreadyClaimedError } from "@/app/lib/pinRedemption";
import { recordInventoryOutEvents } from "@/app/lib/inventoryEvent";
import {
  consumeAvailableStock,
  InsufficientStockError,
} from "@/app/lib/inventoryReservation";

// ============================================================
// PATCH — upgrade reseller package
// City dist upgrades a reseller using a new PIN
// Only adds the DIFFERENCE in points to ancestors (guide rule #7)
// ============================================================


class ResellerUpgradeConflictError extends Error {}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "city") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.is_staff && !user.permissions?.includes("register_reseller")) {
      return NextResponse.json(
        { error: "Your staff account cannot upgrade reseller packages." },
        { status: 403 },
      );
    }

    const { reseller_id, new_pin_id, target_package_id } = await req.json();

    if (!reseller_id || !new_pin_id || !target_package_id) {
      return NextResponse.json(
        { error: "reseller_id, new_pin_id, and target_package_id are required." },
        { status: 400 },
      );
    }

    // Get reseller's current profile
    const resellerProfile = await prisma.resellerProfile.findUnique({
      where: { user_id: reseller_id },
      select: {
        user_id: true,
        package_id: true,
        city_dist_id: true,
        package: {
          select: {
            pairing_bonus_value: true,
            direct_referral_bonus: true,
            name: true,
            products: { select: { product_id: true, quantity: true } },
          },
        },
      },
    });

    if (!resellerProfile)
      return NextResponse.json(
        { error: "Reseller not found." },
        { status: 404 },
      );
    if (resellerProfile.city_dist_id !== user.id)
      return NextResponse.json(
        {
          error:
            "This reseller is not registered under your City Distributor account.",
        },
        { status: 403 },
      );

    // Validate new PIN
    const pin = await prisma.pin.findUnique({
      where: { id: new_pin_id },
      select: {
        id: true,
        pin_code: true,
        status: true,
        city_dist_id: true,
        package_id: true,
        pin_type: true,
        upgrade_from_package_id: true,
        pin_allocation_snapshot: true,
        upgrade_customer_payment_snapshot: true,
        upgrade_reseller_value_snapshot: true,
        upgrade_acquisition_cost_snapshot: true,
        upgrade_acquisition_tier_snapshot: true,
        upgrade_direct_allocation_snapshot: true,
        upgrade_binary_allocation_snapshot: true,
        upgrade_points_difference_snapshot: true,
        upgrade_product_snapshots: {
          select: { product_id: true, quantity: true, unit_acquisition_cost_snapshot: true },
        },
        package: {
          select: {
            pairing_bonus_value: true,
            direct_referral_bonus: true,
            name: true,
            products: { select: { product_id: true, quantity: true } },
          },
        },
      },
    });

    if (!pin || pin.status !== "unused") {
      return NextResponse.json(
        { error: "PIN is invalid or already used." },
        { status: 400 },
      );
    }

    if (pin.city_dist_id !== user.id) {
      return NextResponse.json(
        { error: "This PIN does not belong to your account." },
        { status: 400 },
      );
    }

    if (pin.pin_type !== "upgrade")
      return NextResponse.json(
        { error: "A dedicated Upgrade PIN is required." },
        { status: 400 },
      );
    if (pin.upgrade_from_package_id !== resellerProfile.package_id)
      return NextResponse.json(
        { error: "This Upgrade PIN does not match the current package." },
        { status: 400 },
      );
    if (pin.package_id !== target_package_id)
      return NextResponse.json(
        { error: "This Upgrade PIN does not match the selected target package." },
        { status: 400 },
      );
    if (
      pin.pin_allocation_snapshot == null ||
      pin.upgrade_customer_payment_snapshot == null ||
      pin.upgrade_reseller_value_snapshot == null ||
      pin.upgrade_acquisition_cost_snapshot == null ||
      (pin.upgrade_acquisition_tier_snapshot !== "city" &&
        pin.upgrade_acquisition_tier_snapshot !== "branch") ||
      pin.upgrade_direct_allocation_snapshot == null ||
      pin.upgrade_binary_allocation_snapshot == null ||
      pin.upgrade_points_difference_snapshot == null
    )
      return NextResponse.json(
        { error: "This Upgrade PIN has no complete financial snapshot." },
        { status: 400 },
      );

    // Package IDs prove the configured path. The points credited by this
    // already-sold PIN must remain exactly what Admin snapshotted at issuance.
    const diffPts = Number(pin.upgrade_points_difference_snapshot);
    if (!Number.isInteger(diffPts) || diffPts <= 0) {
      return NextResponse.json(
        { error: "This Upgrade PIN has an invalid points snapshot. Cancel it and generate a new PIN." },
        { status: 400 },
      );
    }

    // The exact physical release is snapshotted when Admin issues the PIN.
    // Later edits to either package cannot change an already sold upgrade.
    const extraProducts = pin.upgrade_product_snapshots;
    if (
      extraProducts.length === 0 ||
      extraProducts.some((item) => item.unit_acquisition_cost_snapshot == null)
    )
      return NextResponse.json(
        { error: "This Upgrade PIN has no product-release snapshot. Cancel it and generate a new PIN from a configured upgrade option." },
        { status: 400 },
      );
    const stock = extraProducts.length
      ? await prisma.inventory.findMany({
          where: {
            owner_id: user.id,
            product_id: { in: extraProducts.map((item) => item.product_id) },
          },
          select: { product_id: true, quantity: true },
        })
      : [];
    if (
      extraProducts.some(
        (item) =>
          (stock.find((row) => row.product_id === item.product_id)?.quantity ||
            0) < item.quantity,
      )
    )
      return NextResponse.json(
        {
          error:
            "Insufficient City inventory for the additional upgrade products.",
        },
        { status: 400 },
      );

    const resellerNode = await prisma.binaryTreeNode.findUnique({
      where: { user_id: reseller_id },
      select: { parent_id: true, position: true },
    });

    await prisma.$transaction(async (tx) => {
      const claimedProfile = await tx.resellerProfile.updateMany({
        where: {
          user_id: reseller_id,
          city_dist_id: user.id,
          package_id: resellerProfile.package_id,
        },
        data: { package_id: pin.package_id },
      });
      if (claimedProfile.count !== 1) {
        throw new ResellerUpgradeConflictError(
          "This reseller's package changed while the upgrade was being processed. Refresh and verify the Upgrade PIN again.",
        );
      }

      const now = await claimUnusedPin(tx, pin.id, reseller_id);
      await tx.upgradeFinancial.create({
        data: {
          upgrade_pin_id: pin.id,
          city_dist_id: user.id,
          reseller_id,
          from_package_id: resellerProfile.package_id,
          to_package_id: pin.package_id,
          customer_payment: new Prisma.Decimal(
            pin.upgrade_customer_payment_snapshot!,
          ),
          reseller_value: new Prisma.Decimal(
            pin.upgrade_reseller_value_snapshot!,
          ),
          product_acquisition_cost: new Prisma.Decimal(
            pin.upgrade_acquisition_cost_snapshot!,
          ),
          pin_allocation: new Prisma.Decimal(pin.pin_allocation_snapshot!),
          registration_profit: new Prisma.Decimal(
            Number(pin.upgrade_reseller_value_snapshot) -
              Number(pin.upgrade_acquisition_cost_snapshot),
          ),
          direct_referral_allocation: new Prisma.Decimal(
            pin.upgrade_direct_allocation_snapshot || 0,
          ),
          direct_referral_paid: new Prisma.Decimal(0),
          direct_referral_retained: new Prisma.Decimal(
            pin.upgrade_direct_allocation_snapshot || 0,
          ),
          binary_commission_allocation: new Prisma.Decimal(
            pin.upgrade_binary_allocation_snapshot!,
          ),
          binary_points_difference: Number(
            pin.upgrade_points_difference_snapshot,
          ),
          from_package_name_snapshot: resellerProfile.package!.name,
          to_package_name_snapshot: pin.package!.name,
          paid_at: now,
        },
      });
      await consumeAvailableStock(
        tx,
        user.id,
        extraProducts.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
        })),
      );

      await recordInventoryOutEvents(tx, {
        ownerId: user.id,
        actorId: user.id,
        actorName: user.full_name || user.username || "City Distributor",
        eventType: "upgrade_package_release",
        referenceType: "upgrade_pin",
        referenceId: pin.id,
        reason: `${resellerProfile.package!.name} → ${pin.package!.name} incremental products released`,
        items: extraProducts.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_cost: Number(item.unit_acquisition_cost_snapshot),
        })),
        metadata: {
          pin_code: pin.pin_code,
          reseller_id,
          from_package_id: resellerProfile.package_id,
          to_package_id: pin.package_id,
          acquisition_tier_snapshot: pin.upgrade_acquisition_tier_snapshot,
        },
      });

      if (resellerNode?.parent_id && resellerNode.position && diffPts > 0) {
        await settleBinaryCommission(tx, {
          sourceUserId: reseller_id,
          sourcePoints: diffPts,
          parentNodeId: resellerNode.parent_id,
          position: resellerNode.position as "left" | "right",
          sourceKind: "upgrade",
          sourceEventId: pin.id,
        });
      }
    });

    return NextResponse.json({
      success: true,
      message: `Reseller upgraded from ${resellerProfile.package?.name} to ${pin.package?.name}. +${diffPts} points added to upline.`,
    });
  } catch (error) {
    if (error instanceof PinAlreadyClaimedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ResellerUpgradeConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: "Available inventory changed during upgrade. Refresh stock and try again." },
        { status: 409 },
      );
    }
    if (
      error instanceof InsufficientBinaryReserveError ||
      error instanceof DuplicateBinarySettlementError
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[UPGRADE ERROR]", error);
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 },
    );
  }
}
