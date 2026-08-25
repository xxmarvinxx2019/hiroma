import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const transfer = await prisma.inventoryTransfer.findFirst({
      where: {
        id,
        ...(user.role === 'admin' ? {} : { recipient_id: user.id }),
      },
    })
    if (!transfer) {
      return NextResponse.json({ error: 'Transfer receipt not found.' }, { status: 404 })
    }
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        transfer_id: id,
        is_sale: false,
      },
      orderBy: { created_at: 'asc' },
    })
    if (movements.length === 0) {
      return NextResponse.json({ error: 'Transfer receipt not found.' }, { status: 404 })
    }

    const first = movements[0]
    const [admin, recipient, products] = await Promise.all([
      prisma.user.findUnique({ where: { id: first.admin_id }, select: { full_name: true, username: true } }),
      prisma.user.findUnique({ where: { id: first.recipient_id }, select: { full_name: true, username: true } }),
      prisma.product.findMany({
        where: { id: { in: movements.map((movement) => movement.product_id) } },
        select: { id: true, name: true, type: true },
      }),
    ])
    const productMap = new Map(products.map((product) => [product.id, product]))
    const canViewInternalValues = user.role === 'admin'

    return NextResponse.json({
      transfer: {
        id,
        reference_number: `TRF-${id.slice(0, 8).toUpperCase()}`,
        status: transfer.status,
        dispatched_at: transfer.dispatched_at,
        received_at: transfer.received_at,
        created_at: transfer.created_at,
        notes: transfer.notes,
        receiving_notes: transfer.receiving_notes,
        sender: admin,
        recipient,
        total_units: movements.reduce((sum, movement) => sum + movement.quantity, 0),
        ...(canViewInternalValues ? { reference_value: movements.reduce((sum, movement) => sum + Number(movement.reference_value), 0) } : {}),
        items: movements.map((movement) => ({
          id: movement.id,
          quantity: movement.quantity,
          ...(canViewInternalValues ? {
            unit_price: Number(movement.unit_price),
            reference_value: Number(movement.reference_value),
          } : {}),
          accepted_quantity: movement.accepted_quantity,
          damaged_quantity: movement.damaged_quantity,
          missing_quantity: movement.missing_quantity,
          recipient_stock_before: movement.recipient_stock_before,
          recipient_stock_after: movement.recipient_stock_after,
          product: productMap.get(movement.product_id) || null,
        })),
      },
    })
  } catch (error) {
    console.error('[INVENTORY TRANSFER RECEIPT ERROR]', error)
    return NextResponse.json({ error: 'Unable to load transfer receipt.' }, { status: 500 })
  }
}

type ReceivingItem = {
  movement_id?: unknown
  accepted_quantity?: unknown
  damaged_quantity?: unknown
  missing_quantity?: unknown
  notes?: unknown
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()
    const action = body.action as 'received_full' | 'received_discrepancy' | 'rejected'
    if (!['received_full', 'received_discrepancy', 'rejected'].includes(action)) {
      return NextResponse.json({ error: 'A valid receiving action is required.' }, { status: 400 })
    }

    const transfer = await prisma.inventoryTransfer.findFirst({
      where: { id, recipient_id: user.id },
    })
    if (!transfer) return NextResponse.json({ error: 'Transfer not found.' }, { status: 404 })
    if (transfer.status !== 'in_transit') {
      return NextResponse.json({ error: 'This transfer has already been received or resolved.' }, { status: 409 })
    }

    const movements = await prisma.inventoryMovement.findMany({
      where: { transfer_id: id, recipient_id: user.id, is_sale: false },
      orderBy: { created_at: 'asc' },
    })
    if (movements.length === 0) return NextResponse.json({ error: 'Transfer items were not found.' }, { status: 404 })

    const submitted = Array.isArray(body.items) ? body.items as ReceivingItem[] : []
    const submittedMap = new Map(submitted.map((item) => [String(item.movement_id || ''), item]))
    const quantities = movements.map((movement) => {
      if (action === 'received_full') {
        return { movement, accepted: movement.quantity, damaged: 0, missing: 0, notes: null as string | null }
      }
      if (action === 'rejected') {
        return { movement, accepted: 0, damaged: 0, missing: 0, notes: typeof body.notes === 'string' ? body.notes.trim() || null : null }
      }
      const item = submittedMap.get(movement.id)
      const accepted = Number(item?.accepted_quantity)
      const damaged = Number(item?.damaged_quantity)
      const missing = Number(item?.missing_quantity)
      if (![accepted, damaged, missing].every((value) => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error(`INVALID_QUANTITY:${movement.id}`)
      }
      if (accepted + damaged + missing !== movement.quantity) {
        throw new Error(`QUANTITY_MISMATCH:${movement.id}`)
      }
      return {
        movement,
        accepted,
        damaged,
        missing,
        notes: typeof item?.notes === 'string' ? item.notes.trim() || null : null,
      }
    })

    if (action === 'rejected' && (typeof body.notes !== 'string' || !body.notes.trim())) {
      return NextResponse.json({ error: 'A reason is required when rejecting a delivery.' }, { status: 400 })
    }

    const hasDiscrepancy = quantities.some((item) => item.damaged > 0 || item.missing > 0)
    const finalStatus = action === 'rejected'
      ? 'rejected'
      : hasDiscrepancy
        ? 'received_discrepancy'
        : 'received_full'
    const receivedAt = new Date()
    const totalAccepted = quantities.reduce((sum, item) => sum + item.accepted, 0)
    const totalDamaged = quantities.reduce((sum, item) => sum + item.damaged, 0)
    const totalMissing = quantities.reduce((sum, item) => sum + item.missing, 0)

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.inventoryTransfer.updateMany({
        where: { id, recipient_id: user.id, status: 'in_transit' },
        data: { status: 'receiving' },
      })
      if (claimed.count !== 1) throw new Error('TRANSFER_ALREADY_RESOLVED')

      for (const item of quantities) {
        let recipientStockAfter = item.movement.recipient_stock_before
        if (item.accepted > 0) {
          const inventory = await tx.inventory.upsert({
            where: { owner_id_product_id: { owner_id: user.id, product_id: item.movement.product_id } },
            update: { quantity: { increment: item.accepted } },
            create: { owner_id: user.id, product_id: item.movement.product_id, quantity: item.accepted, low_stock_threshold: 10 },
            select: { quantity: true },
          })
          recipientStockAfter = inventory.quantity
        }
        await tx.inventoryMovement.update({
          where: { id: item.movement.id },
          data: {
            accepted_quantity: item.accepted,
            damaged_quantity: item.damaged,
            missing_quantity: item.missing,
            receiving_notes: item.notes,
            received_at: receivedAt,
            recipient_stock_after: recipientStockAfter,
          },
        })
      }

      await tx.inventoryTransfer.update({
        where: { id },
        data: {
          status: finalStatus,
          received_at: receivedAt,
          received_by: user.id,
          receiving_notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
        },
      })
      await tx.notification.create({
        data: {
          user_id: transfer.admin_id,
          type: finalStatus === 'received_full' ? 'inventory_transfer_received' : 'inventory_transfer_discrepancy',
          title: finalStatus === 'received_full' ? 'Branch received stock transfer' : finalStatus === 'rejected' ? 'Branch rejected stock transfer' : 'Stock transfer has a discrepancy',
          message: finalStatus === 'received_full'
            ? `${user.full_name} confirmed ${totalAccepted.toLocaleString()} unit(s) received in full.`
            : `${user.full_name} reported ${totalAccepted.toLocaleString()} good, ${totalDamaged.toLocaleString()} damaged, and ${totalMissing.toLocaleString()} missing unit(s).`,
          entity_type: 'inventory_transfer',
          entity_id: id,
          action_url: '/dashboard/admin/inventory',
        },
      })
      await createRequiredAuditLog(tx, {
        user_id: user.id,
        user_name: user.full_name,
        user_role: user.role,
        activity_type: `branch_transfer_${finalStatus}`,
        category: 'distributor',
        description: `${user.full_name} resolved transfer ${transfer.reference_number} as ${finalStatus}.`,
        metadata: { transfer_id: id, total_accepted: totalAccepted, total_damaged: totalDamaged, total_missing: totalMissing },
        ...getClientInfo(req),
      })
    })

    return NextResponse.json({
      success: true,
      status: finalStatus,
      message: finalStatus === 'received_full'
        ? 'Delivery received in full. Accepted stock is now available.'
        : finalStatus === 'rejected'
          ? 'Delivery rejection recorded. No stock was added to available inventory.'
          : 'Delivery discrepancy recorded. Only accepted stock was added to available inventory.',
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('INVALID_QUANTITY:')) {
      return NextResponse.json({ error: 'All receiving quantities must be non-negative whole numbers.' }, { status: 400 })
    }
    if (error instanceof Error && error.message.startsWith('QUANTITY_MISMATCH:')) {
      return NextResponse.json({ error: 'For every product, Good + Damaged + Missing must equal the expected quantity.' }, { status: 400 })
    }
    if (error instanceof Error && error.message === 'TRANSFER_ALREADY_RESOLVED') {
      return NextResponse.json({ error: 'This transfer was already resolved by another request.' }, { status: 409 })
    }
    console.error('[INVENTORY TRANSFER RECEIVING ERROR]', error)
    return NextResponse.json({ error: 'Unable to record delivery receiving.' }, { status: 500 })
  }
}
