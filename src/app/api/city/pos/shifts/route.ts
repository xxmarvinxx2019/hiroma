import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/app/lib/auth";
import prisma from "@/app/lib/prisma";
import { notifyPosReviewers } from "@/app/lib/posNotifications";

function money(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000_000
    ? Math.round(parsed * 100) / 100
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function closingReference() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SHIFT-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "city")
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const body = await req.json();
    const terminalId =
      typeof body.terminal_id === "string" ? body.terminal_id : "";
    const openingCash = money(body.opening_cash);
    if (!terminalId || openingCash == null)
      return NextResponse.json(
        { error: "A valid terminal and opening cash amount are required." },
        { status: 400 },
      );
    const actorId = user.actor_id || user.id;
    const terminal = await prisma.posTerminal.findFirst({
      where: { id: terminalId, owner_id: user.id, is_active: true },
      select: { id: true },
    });
    if (!terminal)
      return NextResponse.json(
        { error: "This POS terminal is not assigned to your location." },
        { status: 403 },
      );
    const blockingShift = await prisma.posShift.findFirst({
      where: {
        owner_id: user.id,
        terminal_id: terminal.id,
        opened_by_id: actorId,
        status: { in: ["locally_closed", "needs_review"] },
      },
      orderBy: { opened_at: "desc" },
      select: { id: true, status: true, opened_at: true, closing_explanation: true },
    });
    if (blockingShift) {
      return NextResponse.json(
        {
          error: blockingShift.status === "needs_review"
            ? "Your previous shift was returned for recount. Review the manager note and resubmit that shift before opening another one."
            : "Your previous shift is still awaiting independent manager review. You cannot open another shift yet.",
          code: "SHIFT_REVIEW_PENDING",
          blocking_shift: blockingShift,
        },
        { status: 409 },
      );
    }
    try {
      const shift = await prisma.posShift.create({
        data: {
          owner_id: user.id,
          terminal_id: terminal.id,
          opened_by_id: actorId,
          active_terminal_key: terminal.id,
          opening_cash: new Prisma.Decimal(openingCash),
        },
        select: { id: true, status: true, opening_cash: true, opened_at: true },
      });
      return NextResponse.json({ shift }, { status: 201 });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const current = await prisma.posShift.findFirst({
          where: { terminal_id: terminal.id, status: "open" },
          select: { id: true, opened_at: true },
        });
        return NextResponse.json(
          {
            error: "This terminal already has an open shift.",
            current_shift: current,
          },
          { status: 409 },
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("[POS OPEN SHIFT]", error);
    return NextResponse.json(
      { error: "Unable to open the POS shift." },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "city")
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const body = await req.json();
    const shiftId = typeof body.shift_id === "string" ? body.shift_id : "";
    const countedCash = money(body.counted_cash);
    if (!shiftId || countedCash == null)
      return NextResponse.json(
        { error: "Shift and counted cash are required." },
        { status: 400 },
      );
    const actorId = user.actor_id || user.id;
    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true },
    });
    const isBranch = profile?.dist_level === "branch";
    const result = await prisma.$transaction(async (tx) => {
      const shift = await tx.posShift.findFirst({
        where: {
          id: shiftId,
          owner_id: user.id,
          opened_by_id: actorId,
          status: { in: isBranch ? ["open", "needs_review"] : ["open"] },
        },
        select: {
          id: true,
          terminal_id: true,
          opening_cash: true,
          closing_count_attempts: true,
        },
      });
      if (!shift) return null;
      const pending = await tx.posTransaction.count({
        where: {
          shift_id: shift.id,
          status: {
            in: [
              "pending_sync",
              "syncing",
              "synced_pending_review",
              "needs_correction",
            ],
          },
        },
      });
      if (pending > 0) return { blocked: true as const, pending };
      const cashSales = await tx.posTransaction.aggregate({
        where: {
          shift_id: shift.id,
          payment_method_snapshot: "cash",
          status: { in: ["approved", "finalized"] },
        },
        _sum: { total_snapshot: true },
      });
      const approvedCashRefunds = await tx.posAdjustmentRequest.aggregate({
        where: {
          request_type: "refund",
          status: "approved",
          transaction: {
            shift_id: shift.id,
            payment_method_snapshot: "cash",
            status: { in: ["approved", "finalized"] },
          },
        },
        _sum: { amount_snapshot: true },
      });
      const pendingPaidOut = await tx.posCashMovement.count({
        where: {
          shift_id: shift.id,
          movement_type: "paid_out",
          status: "pending",
        },
      });
      if (pendingPaidOut > 0)
        return { pendingPaidOut: true as const, pending: pendingPaidOut };
      const appliedMovements = await tx.posCashMovement.groupBy({
        by: ["movement_type"],
        where: {
          shift_id: shift.id,
          OR: [
            {
              movement_type: "paid_in",
              status: { in: ["applied", "approved"] },
            },
            { movement_type: "paid_out", status: "approved" },
          ],
        },
        _sum: { amount: true },
      });
      const paidIn = Number(
        appliedMovements.find((row) => row.movement_type === "paid_in")?._sum
          .amount || 0,
      );
      const paidOut = Number(
        appliedMovements.find((row) => row.movement_type === "paid_out")?._sum
          .amount || 0,
      );
      const expected =
        Number(shift.opening_cash) +
        Number(cashSales._sum.total_snapshot || 0) -
        Number(approvedCashRefunds._sum.amount_snapshot || 0) +
        paidIn -
        paidOut;
      if (isBranch) {
        if (!Array.isArray(body.inventory_counts))
          return { inventoryRequired: true as const };
        const inventory = await tx.inventory.findMany({
          where: { owner_id: user.id },
          orderBy: { product: { name: "asc" } },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                branch_price: true,
                cost_price: true,
              },
            },
          },
        });
        if (inventory.length === 0) return { inventoryEmpty: true as const };
        const submitted = new Map<
          string,
          { counted: number; damaged: number; expired: number }
        >();
        for (const raw of body.inventory_counts as Array<
          Record<string, unknown>
        >) {
          const productId =
            typeof raw.product_id === "string" ? raw.product_id : "";
          const counted = nonNegativeInteger(raw.counted_quantity);
          const damaged = nonNegativeInteger(raw.damaged_quantity) ?? 0;
          const expired = nonNegativeInteger(raw.expired_quantity) ?? 0;
          if (
            !productId ||
            submitted.has(productId) ||
            counted === null ||
            damaged + expired > counted
          )
            return { invalidInventory: true as const };
          submitted.set(productId, { counted, damaged, expired });
        }
        if (
          submitted.size !== inventory.length ||
          inventory.some((item) => !submitted.has(item.product_id))
        )
          return { incompleteInventory: true as const };
        const rows = inventory.map((item) => {
          const count = submitted.get(item.product_id)!;
          const saleable = count.counted - count.damaged - count.expired;
          return {
            item,
            ...count,
            saleable,
            variance: saleable - item.quantity,
          };
        });
        const cashMismatch = Math.abs(countedCash - expected) >= 0.005;
        const inventoryMismatch = rows.some((row) => row.variance !== 0);
        const mismatch = cashMismatch || inventoryMismatch;
        const recountConfirmed = body.recount_confirmed === true;
        const legacyExplanation =
          typeof body.explanation === "string"
            ? body.explanation.trim().slice(0, 1000)
            : "";
        const cashExplanation =
          typeof body.cash_explanation === "string"
            ? body.cash_explanation.trim().slice(0, 500)
            : legacyExplanation;
        const inventoryExplanation =
          typeof body.inventory_explanation === "string"
            ? body.inventory_explanation.trim().slice(0, 500)
            : legacyExplanation;
        if (mismatch && shift.closing_count_attempts < 1 && !recountConfirmed) {
          await tx.posShift.update({
            where: { id: shift.id },
            data: { closing_count_attempts: 1 },
          });
          return {
            recountRequired: true as const,
            cashMismatch,
            inventoryMismatch,
          };
        }
        const missingCashExplanation =
          cashMismatch && cashExplanation.length < 5;
        const missingInventoryExplanation =
          inventoryMismatch && inventoryExplanation.length < 5;
        if (missingCashExplanation || missingInventoryExplanation) {
          return {
            explanationRequired: true as const,
            cash: missingCashExplanation,
            inventory: missingInventoryExplanation,
          };
        }
        const explanation = [
          cashMismatch ? `Cash recount: ${cashExplanation}` : "",
          inventoryMismatch ? `Inventory recount: ${inventoryExplanation}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const audit = await tx.inventoryAuditSession.upsert({
          where: { pos_shift_id: shift.id },
          update: {
            status: "submitted",
            notes: explanation || "Branch end-of-shift blind count",
            submitted_at: new Date(),
            items: {
              deleteMany: {},
              create: rows.map((row) => ({
                inventory_id: row.item.id,
                product_id: row.item.product_id,
                product_name_snapshot: row.item.product.name,
                expected_quantity: row.item.quantity,
                counted_quantity: row.counted,
                damaged_quantity: row.damaged,
                expired_quantity: row.expired,
                missing_quantity: Math.max(0, row.item.quantity - row.saleable),
                variance_quantity: row.variance,
                unit_cost_snapshot: new Prisma.Decimal(
                  Number(row.item.product.branch_price) ||
                    Number(row.item.product.cost_price),
                ),
                variance_value: new Prisma.Decimal(
                  row.variance *
                    (Number(row.item.product.branch_price) ||
                      Number(row.item.product.cost_price)),
                ),
                notes: explanation || null,
                counted_by: actorId,
                counted_at: new Date(),
              })),
            },
          },
          create: {
            reference_number: closingReference(),
            owner_id: user.id,
            pos_shift_id: shift.id,
            status: "submitted",
            scope: "shift_closing",
            started_by: actorId,
            started_by_name_snapshot:
              user.actor_name || user.full_name || user.username,
            notes: explanation || "Branch end-of-shift blind count",
            submitted_at: new Date(),
            items: {
              create: rows.map((row) => ({
                inventory_id: row.item.id,
                product_id: row.item.product_id,
                product_name_snapshot: row.item.product.name,
                expected_quantity: row.item.quantity,
                counted_quantity: row.counted,
                damaged_quantity: row.damaged,
                expired_quantity: row.expired,
                missing_quantity: Math.max(0, row.item.quantity - row.saleable),
                variance_quantity: row.variance,
                unit_cost_snapshot: new Prisma.Decimal(
                  Number(row.item.product.branch_price) ||
                    Number(row.item.product.cost_price),
                ),
                variance_value: new Prisma.Decimal(
                  row.variance *
                    (Number(row.item.product.branch_price) ||
                      Number(row.item.product.cost_price)),
                ),
                notes: explanation || null,
                counted_by: actorId,
                counted_at: new Date(),
              })),
            },
          },
          select: { id: true, reference_number: true },
        });
        await tx.inventoryAuditEvent.create({
          data: {
            owner_id: user.id,
            actor_id: actorId,
            actor_name_snapshot:
              user.actor_name || user.full_name || user.username,
            event_type: "shift_closing_count_submitted",
            reference_type: "inventory_audit",
            reference_id: audit.id,
            reason:
              explanation ||
              "Branch end-of-shift cash and inventory count submitted",
            metadata: {
              shift_id: shift.id,
              terminal_id: shift.terminal_id,
              mismatch,
              recount_confirmed: recountConfirmed,
            },
          },
        });
        const submittedShift = await tx.posShift.update({
          where: { id: shift.id },
          data: {
            status: "locally_closed",
            counted_cash: new Prisma.Decimal(countedCash),
            expected_cash_snapshot: new Prisma.Decimal(expected),
            variance_snapshot: new Prisma.Decimal(countedCash - expected),
            closing_explanation: explanation || null,
            closing_submitted_at: new Date(),
            local_closed_at: new Date(),
          },
          select: { id: true, status: true, closing_submitted_at: true },
        });
        return {
          branchSubmitted: true as const,
          shift: submittedShift,
          audit,
          reconciliation: {
            cashMatched: !cashMismatch,
            inventoryMatched: !inventoryMismatch,
            hasVariance: mismatch,
          },
        };
      }
      return tx.posShift.update({
        where: { id: shift.id },
        data: {
          closed_by_id: actorId,
          status: "finalized",
          active_terminal_key: null,
          counted_cash: new Prisma.Decimal(countedCash),
          expected_cash_snapshot: new Prisma.Decimal(expected),
          variance_snapshot: new Prisma.Decimal(countedCash - expected),
          local_closed_at: new Date(),
          server_finalized_at: new Date(),
        },
        select: {
          id: true,
          status: true,
          expected_cash_snapshot: true,
          counted_cash: true,
          variance_snapshot: true,
          server_finalized_at: true,
        },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20_000,
    });
    if (!result)
      return NextResponse.json(
        { error: "Open shift not found or already closed." },
        { status: 409 },
      );
    if ("blocked" in result)
      return NextResponse.json(
        {
          error: `This shift cannot close because ${result.pending} transaction${result.pending === 1 ? " is" : "s are"} not fully synchronized. Reconnect, finish synchronization, and resolve any transaction needing attention.`,
          code: "SHIFT_SYNC_INCOMPLETE",
          pending_transactions: result.pending,
        },
        { status: 409 },
      );
    if ("pendingPaidOut" in result)
      return NextResponse.json(
        {
          error: `This shift cannot close because ${result.pending} paid-out request${result.pending === 1 ? " is" : "s are"} still waiting for an independent review.`,
          code: "SHIFT_CASH_MOVEMENT_PENDING",
          pending_paid_out: result.pending,
        },
        { status: 409 },
      );
    if ("inventoryRequired" in result)
      return NextResponse.json(
        {
          error:
            "A complete physical inventory count is required before this Branch shift can be submitted.",
          code: "SHIFT_INVENTORY_REQUIRED",
        },
        { status: 400 },
      );
    if ("inventoryEmpty" in result)
      return NextResponse.json(
        {
          error:
            "This Branch has no inventory records to count. Ask the Branch manager to review the inventory setup.",
          code: "SHIFT_INVENTORY_EMPTY",
        },
        { status: 409 },
      );
    if ("invalidInventory" in result)
      return NextResponse.json(
        {
          error:
            "Review the physical counts. Quantities must be whole numbers, and damaged plus expired units cannot exceed the physical count.",
          code: "SHIFT_INVENTORY_INVALID",
        },
        { status: 400 },
      );
    if ("incompleteInventory" in result)
      return NextResponse.json(
        {
          error:
            "Every Branch product must be physically counted before submitting the shift.",
          code: "SHIFT_INVENTORY_INCOMPLETE",
        },
        { status: 400 },
      );
    if ("recountRequired" in result)
      return NextResponse.json(
        {
          error:
            "One or more submitted counts do not match the system record. Recount the indicated section, then submit the final count.",
          code: "SHIFT_RECOUNT_REQUIRED",
          mismatch_categories: {
            cash: result.cashMismatch,
            inventory: result.inventoryMismatch,
          },
        },
        { status: 409 },
      );
    if ("explanationRequired" in result)
      return NextResponse.json(
        {
          error:
            "A difference remains after recounting. Explain each mismatched section before submitting for manager review.",
          code: "SHIFT_EXPLANATION_REQUIRED",
          required_explanations: {
            cash: result.cash,
            inventory: result.inventory,
          },
        },
        { status: 400 },
      );
    if ("branchSubmitted" in result) {
      await notifyPosReviewers({
        ownerId: user.id,
        actorId,
        permission: "pos_approve",
        type: "pos_shift_count_pending",
        title: "Cashier shift count needs approval",
        message: `End-of-shift cash and inventory counts are ready for review. Reference ${result.audit.reference_number}.`,
        entityType: "inventory_audit",
        entityId: result.audit.id,
        actionUrl: "/dashboard/city/pos/approvals",
      });
      return NextResponse.json({
        shift: result.shift,
        audit: result.audit,
        pending_approval: true,
        reconciliation: {
          cash_matched: result.reconciliation.cashMatched,
          inventory_matched: result.reconciliation.inventoryMatched,
          has_variance: result.reconciliation.hasVariance,
        },
      });
    }
    return NextResponse.json({ shift: result });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return NextResponse.json(
        {
          error:
            "This shift was changed by another close request. Refresh the shift before trying again.",
          code: "SHIFT_CLOSE_CONFLICT",
        },
        { status: 409 },
      );
    }
    console.error("[POS CLOSE SHIFT]", error);
    return NextResponse.json(
      { error: "Unable to close the POS shift." },
      { status: 500 },
    );
  }
}
