import prisma from '@/app/lib/prisma'

export async function settleClosedProductBinaryPools() {
  const [schema] = await prisma.$queryRaw<{ ready: boolean; readiness: boolean; deferred: boolean; expiry: boolean }[]>`
    SELECT to_regprocedure('public.release_product_binary_pool_week(date)') IS NOT NULL AS ready,
      to_regprocedure('public.verify_product_binary_week_readiness(date)') IS NOT NULL AS readiness,
      to_regprocedure('public.retry_deferred_product_binary_credit(date,text)') IS NOT NULL AS deferred,
      to_regprocedure('public.expire_deferred_product_binary_credits()') IS NOT NULL AS expiry
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

  let verified = 0
  let held = 0
  if (schema.readiness) {
    const dueChecks = await prisma.$queryRaw<{ week: string }[]>`
      SELECT to_char(week_start, 'YYYY-MM-DD') AS week FROM product_binary_pool_weeks
      WHERE closed_at IS NOT NULL AND released_at IS NULL
        AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date >= week_start + 8
      ORDER BY week_start LIMIT 10
    `
    for (const { week } of dueChecks) {
      const [check] = await prisma.$queryRaw<{ blocker: string | null }[]>`
        SELECT public.verify_product_binary_week_readiness(${week}::date) AS blocker
      `
      if (check.blocker) held++
      else verified++
    }
  }

  const releases = await prisma.$queryRaw<{ week: string }[]>`
    SELECT to_char(week_start, 'YYYY-MM-DD') AS week FROM product_binary_pool_weeks
    WHERE closed_at IS NOT NULL AND released_at IS NULL
      AND CURRENT_TIMESTAMP >= (((week_start + 9) + time '10:00') AT TIME ZONE 'Asia/Manila')
      AND (${!schema.readiness} OR (to_jsonb(product_binary_pool_weeks)->>'readiness_checked_at' IS NOT NULL
        AND to_jsonb(product_binary_pool_weeks)->>'readiness_blocker' IS NULL))
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
  if (schema.expiry) await prisma.$queryRaw`SELECT public.expire_deferred_product_binary_credits()`
  if (schema.deferred) {
    const deferred = await prisma.$queryRaw<{ week: string; member: string }[]>`
      SELECT to_char(a.week_start, 'YYYY-MM-DD') AS week, a.recipient_user_id AS member
      FROM product_binary_pool_allocations a JOIN product_binary_pool_weeks w USING (week_start)
      JOIN users u ON u.id = a.recipient_user_id JOIN wallets wallet ON wallet.user_id = u.id
      WHERE w.released_at IS NOT NULL AND a.commission_id IS NULL AND a.amount_centavos > 0
        AND to_jsonb(a)->>'retained_at' IS NULL
        AND u.status = 'active' AND u.role = 'reseller'
      ORDER BY a.week_start, a.recipient_user_id LIMIT 25
    `
    for (const { week, member } of deferred) {
      try {
        const [result] = await prisma.$queryRaw<{ credited: boolean }[]>`
          SELECT public.retry_deferred_product_binary_credit(${week}::date, ${member}) AS credited
        `
        if (result.credited) credited++
      } catch (error) {
        failed++
        console.error('[PRODUCT BINARY DEFERRED CREDIT]', error)
      }
    }
  }
  const [backlog] = await prisma.$queryRaw<{ pending: number }[]>`
    SELECT COUNT(*)::int AS pending
    FROM product_binary_pool_allocations a JOIN product_binary_pool_weeks w USING (week_start)
    WHERE w.closed_at IS NOT NULL AND a.commission_id IS NULL AND a.amount_centavos > 0
        AND to_jsonb(a)->>'retained_at' IS NULL
  `
  return { closed: weeks.length, credited, failed, pending: backlog.pending, verified, held }
}
