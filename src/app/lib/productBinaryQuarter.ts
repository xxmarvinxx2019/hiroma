import { Prisma } from '@prisma/client'

export const PRODUCT_BINARY_BASE_POINTS = 10
export const PRODUCT_BINARY_PESO_PER_POINT = 0.5
export const PRODUCT_BINARY_RANK_POINTS = [20, 30, 40] as const
export const PRODUCT_BINARY_DEFAULT_THRESHOLDS = [30, 50, 100] as const

type Tx = Prisma.TransactionClient

export function getManilaQuarter(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit',
  }).formatToParts(at)
  const year = Number(parts.find(part => part.type === 'year')?.value)
  const month = Number(parts.find(part => part.type === 'month')?.value)
  const quarter = Math.floor((month - 1) / 3) + 1
  const startMonth = (quarter - 1) * 3 + 1
  const nextQuarterMonth = startMonth + 3
  const nextYear = nextQuarterMonth > 12 ? year + 1 : year
  const normalizedNextMonth = nextQuarterMonth > 12 ? nextQuarterMonth - 12 : nextQuarterMonth
  return {
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    start: new Date(`${year}-${String(startMonth).padStart(2, '0')}-01T00:00:00+08:00`),
    endExclusive: new Date(`${nextYear}-${String(normalizedNextMonth).padStart(2, '0')}-01T00:00:00+08:00`),
  }
}

/** Reset one reseller atomically when their stored qualification belongs to an older quarter. */
export async function ensureCurrentProductBinaryQuarter(tx: Tx, userId: string, at = new Date()) {
  const quarter = getManilaQuarter(at)
  // Deployments can briefly run new application code before the matching database
  // migration is applied. Check the schema first so read-only reseller pages keep
  // working during that window; the quarterly reset activates automatically once
  // the migration adds the column.
  const columnRows = await tx.$queryRaw<{ available: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'reseller_profiles'
        AND column_name = 'qualification_quarter_start'
    ) AS available
  `
  if (!columnRows[0]?.available) return quarter

  await tx.$executeRaw`
    UPDATE reseller_profiles
    SET total_pu = 0, rank = 'default', qualification_quarter_start = ${quarter.start}
    WHERE user_id = ${userId}
      AND (qualification_quarter_start IS NULL OR qualification_quarter_start <> ${quarter.start})
  `
  return quarter
}

export function requiredRankPoints(sequence: number) {
  return PRODUCT_BINARY_RANK_POINTS[sequence - 1] ?? null
}
