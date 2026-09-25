export const PRODUCT_BINARY_PAIR_AMOUNT = 5
export const PRODUCT_BINARY_PAIR_POINTS = 10

export const PRODUCT_BINARY_DAILY_CAPS = {
  starter: 20,
  silver: 40,
  gold: 100,
} as const

export type ProductBinaryPlanName = keyof typeof PRODUCT_BINARY_DAILY_CAPS

export function getProductBinaryDailyCap(packageName: string) {
  const normalized = packageName.trim().toLowerCase() as ProductBinaryPlanName
  return PRODUCT_BINARY_DAILY_CAPS[normalized] ?? PRODUCT_BINARY_DAILY_CAPS.starter
}
