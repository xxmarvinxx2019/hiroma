import type { Prisma } from '@prisma/client'

export function validateProductPuExpiryMonths(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 120) {
    throw new Error('Product PU expiry must be a whole number from 1 to 120 months.')
  }
  return value
}

export async function getProductPuExpiryMonths(db: Pick<Prisma.TransactionClient, '$queryRaw'>) {
  const [setting] = await db.$queryRaw<{ value: string }[]>`
    SELECT value FROM system_settings WHERE key='product_pu_expiry_months'
  `
  return setting ? validateProductPuExpiryMonths(Number(setting.value)) : 12
}
