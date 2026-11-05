import prisma from '@/app/lib/prisma'

export async function settleClosedProductBinaryPools() {
  const [schema] = await prisma.$queryRaw<{ ready: boolean }[]>`
    SELECT to_regprocedure('public.release_product_binary_pool_week(date)') IS NOT NULL AS ready
  `
  if (!schema.ready) return { closed: 0, credited: 0, failed: 0, pending: 0 }

  const weeks = await prisma.$queryRaw<{ week: string }[]>`
    SELECT to_char(week_start, 'YYYY-MM-DD') AS week
    FROM product_binary_pool_weeks
    WHERE closed_at IS NULL AND CURRENT_TIMESTAMP >= ((week_start + 7)::timestamp AT TIME ZONE 'Asia/Manila')
    ORDER BY week_start LIMIT 10
  `
  for (const { week } of weeks) {
    await prisma.$queryRaw`SELECT public.close_product_binary_pool_week(${week}::date)::text`
  }

  const releases = await prisma.$queryRaw<{ week: string }[]>`
    SELECT to_char(week_start, 'YYYY-MM-DD') AS week FROM product_binary_pool_weeks
    WHERE closed_at IS NOT NULL AND released_at IS NULL
      AND CURRENT_TIMESTAMP >= (((week_start + 9) + time '10:00') AT TIME ZONE 'Asia/Manila')
    ORDER BY week_start LIMIT 1
  `
  let credited = 0
  let failed = 0
  for (const { week } of releases) {
    try {
      const [result] = await prisma.$queryRaw<{ credited: number }[]>`
        SELECT public.release_product_binary_pool_week(${week}::date) AS credited
      `
      credited += result.credited
    } catch (error) {
      failed++
      console.error('[PRODUCT BINARY WEEKLY RELEASE]', error)
    }
  }
  const [backlog] = await prisma.$queryRaw<{ pending: number }[]>`
    SELECT COUNT(*)::int AS pending
    FROM product_binary_pool_allocations a JOIN product_binary_pool_weeks w USING (week_start)
    WHERE w.closed_at IS NOT NULL AND a.commission_id IS NULL AND a.amount_centavos > 0
  `
  return { closed: weeks.length, credited, failed, pending: backlog.pending }
}
