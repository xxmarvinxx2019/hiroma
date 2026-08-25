import type { Prisma } from '@prisma/client'

type InventoryTx = Prisma.TransactionClient

export type InventoryOutEventItem = {
  product_id: string
  quantity: number
  unit_cost: number
}

type RecordInventoryOutArgs = {
  ownerId: string
  actorId: string
  actorName: string
  eventType: string
  referenceType: 'order' | 'registration_pin' | 'upgrade_pin'
  referenceId: string
  reason: string
  items: InventoryOutEventItem[]
  metadata?: Prisma.InputJsonValue
}

// Call only after stock has been decremented inside the same transaction.
// If event creation fails, the caller's transaction rolls the stock movement back.
export async function recordInventoryOutEvents(tx: InventoryTx, args: RecordInventoryOutArgs) {
  for (const item of args.items) {
    const inventory = await tx.inventory.findUniqueOrThrow({
      where: { owner_id_product_id: { owner_id: args.ownerId, product_id: item.product_id } },
      select: { quantity: true },
    })
    await tx.inventoryAuditEvent.create({
      data: {
        owner_id: args.ownerId,
        product_id: item.product_id,
        actor_id: args.actorId,
        actor_name_snapshot: args.actorName,
        event_type: args.eventType,
        quantity_delta: -item.quantity,
        quantity_before: inventory.quantity + item.quantity,
        quantity_after: inventory.quantity,
        unit_cost_snapshot: item.unit_cost,
        total_value: item.quantity * item.unit_cost,
        reference_type: args.referenceType,
        reference_id: args.referenceId,
        reason: args.reason,
        metadata: args.metadata,
      },
    })
  }
}
