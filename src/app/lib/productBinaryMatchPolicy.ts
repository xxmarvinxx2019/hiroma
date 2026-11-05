import type { Prisma } from '@prisma/client'

export const PRODUCT_BINARY_MATCH_KEY = 'product_binary_pu_per_leg'

export function isProductBinaryPuPerLeg(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 2147483647
}

export async function getProductBinaryPuPerLeg(db: Pick<Prisma.TransactionClient, 'systemSetting'>) {
  const setting = await db.systemSetting.findUnique({ where: { key: PRODUCT_BINARY_MATCH_KEY } })
  if (!setting) return 2
  const value = Number(setting.value)
  if (!isProductBinaryPuPerLeg(value)) throw new Error('Invalid Product Binary match setting.')
  return value
}

export const PRODUCT_BINARY_AMOUNT_KEY = 'product_binary_pair_amount'

export function isProductBinaryPairAmount(value: unknown): value is number {
  return typeof value === 'number' && value >= 0.5 && value <= 20 && Number.isInteger(value * 2)
}

export async function getProductBinaryPairAmount(db: Pick<Prisma.TransactionClient, 'systemSetting'>) {
  const setting = await db.systemSetting.findUnique({ where: { key: PRODUCT_BINARY_AMOUNT_KEY } })
  const amount = setting ? Number(setting.value) : 5
  if (!isProductBinaryPairAmount(amount)) throw new Error('Invalid Product Binary pair amount.')
  return amount
}
