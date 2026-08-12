import type { Prisma } from '@prisma/client'

type InventoryTx = Prisma.TransactionClient

export type StockItem = { product_id: string; quantity: number }

export class InsufficientStockError extends Error {
  constructor(public readonly productId: string) {
    super(`Insufficient available stock for product ${productId}.`)
    this.name = 'InsufficientStockError'
  }
}

export function validateStockItems(items: StockItem[]) {
  return items.length > 0 && items.every((item) =>
    typeof item.product_id === 'string' &&
    item.product_id.length > 0 &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0
  )
}

export async function reserveOrderStock(tx: InventoryTx, ownerId: string, items: StockItem[]) {
  for (const item of items) {
    const changed = await tx.$executeRaw`
      UPDATE "inventory"
      SET "reserved_quantity" = "reserved_quantity" + ${item.quantity},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "owner_id" = ${ownerId}
        AND "product_id" = ${item.product_id}
        AND ("quantity" - "reserved_quantity") >= ${item.quantity}
    `
    if (changed !== 1) throw new InsufficientStockError(item.product_id)
  }
}

export async function releaseOrderStock(tx: InventoryTx, ownerId: string, items: StockItem[]) {
  for (const item of items) {
    const changed = await tx.$executeRaw`
      UPDATE "inventory"
      SET "reserved_quantity" = "reserved_quantity" - ${item.quantity},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "owner_id" = ${ownerId}
        AND "product_id" = ${item.product_id}
        AND "reserved_quantity" >= ${item.quantity}
    `
    if (changed !== 1) throw new Error(`Stock reservation is missing for product ${item.product_id}.`)
  }
}

export async function finalizeReservedStock(tx: InventoryTx, ownerId: string, items: StockItem[]) {
  for (const item of items) {
    const changed = await tx.$executeRaw`
      UPDATE "inventory"
      SET "quantity" = "quantity" - ${item.quantity},
          "reserved_quantity" = "reserved_quantity" - ${item.quantity},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "owner_id" = ${ownerId}
        AND "product_id" = ${item.product_id}
        AND "quantity" >= ${item.quantity}
        AND "reserved_quantity" >= ${item.quantity}
    `
    if (changed !== 1) throw new Error(`Reserved stock cannot be finalized for product ${item.product_id}.`)
  }
}

export async function consumeAvailableStock(tx: InventoryTx, ownerId: string, items: StockItem[]) {
  for (const item of items) {
    const changed = await tx.$executeRaw`
      UPDATE "inventory"
      SET "quantity" = "quantity" - ${item.quantity},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "owner_id" = ${ownerId}
        AND "product_id" = ${item.product_id}
        AND ("quantity" - "reserved_quantity") >= ${item.quantity}
    `
    if (changed !== 1) throw new InsufficientStockError(item.product_id)
  }
}
