import prisma from '@/app/lib/prisma'

export async function settleClosedProductBinaryPools(releaseDeadline = Date.now() + 45_000) {
  const [schema] = await prisma.$queryRaw<{ ready: boolean; deferred: boolean; expiry: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('public.product_binary_pool_weeks')
        AND attname = 'release_started_at' AND NOT attisdropped
    ) AND to_regclass('public.product_binary_week_preparation') IS NOT NULL
      AND to_regprocedure('public.seal_closed_product_binary_allocation()') IS NOT NULL AS ready,
      to_regprocedure('public.retry_deferred_product_binary_credit(date,text)') IS NOT NULL AS deferred,
      to_regprocedure('public.expire_deferred_product_binary_credits()') IS NOT NULL AS expiry
  `
  if (!schema.ready) throw new Error('Product Binary batch preparation migrations are required.')

  let credited = 0
  let failed = 0
  const retryDeadline = Math.min(releaseDeadline, Date.now() + 4_000)
  if (schema.expiry) await prisma.$queryRaw`SELECT public.expire_deferred_product_binary_credits()`
  if (schema.deferred) {
    let cursor: { week: string; member: string } | null = null
    while (retryDeadline - Date.now() >= 500) {
      const deferred: { week: string; member: string }[] = await prisma.$queryRaw`
        SELECT to_char(a.week_start, 'YYYY-MM-DD') AS week, a.recipient_user_id AS member
        FROM product_binary_pool_allocations a JOIN product_binary_pool_weeks w USING (week_start)
        JOIN users u ON u.id = a.recipient_user_id JOIN wallets wallet ON wallet.user_id = u.id
        WHERE w.released_at IS NOT NULL AND a.commission_id IS NULL AND a.amount_centavos > 0
          AND to_jsonb(a)->>'retained_at' IS NULL
          AND u.status = 'active' AND u.role = 'reseller'
          AND (${cursor?.week ?? null}::date IS NULL OR
            (a.week_start, a.recipient_user_id) > (${cursor?.week ?? null}::date, ${cursor?.member ?? null}::text))
        ORDER BY a.week_start, a.recipient_user_id LIMIT 25
      `
      if (!deferred.length) break
      for (const entry of deferred) {
        const budget = Math.min(2_000, retryDeadline - Date.now())
        if (budget < 500) break
        cursor = entry
        try {
          const [result] = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(budget - 100)}, true)`
            return tx.$queryRaw<{ credited: boolean }[]>`
              SELECT public.retry_deferred_product_binary_credit(${entry.week}::date, ${entry.member}) AS credited
            `
          }, { maxWait: 500, timeout: budget })
          if (result.credited) credited++
        } catch (error) {
          failed++
          console.error('[PRODUCT BINARY DEFERRED CREDIT]', error)
        }
      }
    }
  }

  const preparationDeadline = Math.min(releaseDeadline, Date.now() + 8_000)
  const weeks = await prisma.$queryRaw<{ week: string }[]>`
    SELECT to_char(week_start, 'YYYY-MM-DD') AS week
    FROM product_binary_pool_weeks
    WHERE closed_at IS NULL AND CURRENT_TIMESTAMP >= ((week_start + 7)::timestamp AT TIME ZONE 'Asia/Manila')
    ORDER BY week_start LIMIT 10
  `
  let closed = 0
  for (const { week } of weeks) {
    while (preparationDeadline - Date.now() >= 1_500) {
      try {
        const budget = Math.min(5_000, preparationDeadline - Date.now() - 500)
        const result = await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(budget)}, true)`
          return tx.$queryRaw<{ closed: boolean }[]>`
            SELECT (public.close_product_binary_pool_week(${week}::date)).closed_at IS NOT NULL AS closed
          `
        }, { maxWait: 500, timeout: budget + 500 })
        if (result[0].closed) {
          closed++
          break
        }
      } catch (error) {
        failed++
        console.error('[PRODUCT BINARY WEEKLY CLOSE]', { week, error })
        break
      }
    }
  }

  let verified = 0
  let held = 0

  const dueChecks = await prisma.$queryRaw<{ week: string }[]>`
    SELECT to_char(week_start, 'YYYY-MM-DD') AS week FROM product_binary_pool_weeks
    WHERE closed_at IS NOT NULL AND released_at IS NULL AND release_started_at IS NULL
      AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date >= week_start + 7
      AND (readiness_checked_at IS NULL OR readiness_blocker = 'Verification in progress'
        OR readiness_checked_at <= CURRENT_TIMESTAMP - interval '1 hour')
    ORDER BY week_start LIMIT 10
  `
  const verificationDeadline = Math.min(releaseDeadline, Date.now() + 4_000)
  for (const { week } of dueChecks) {
    while (verificationDeadline - Date.now() >= 1_500) {
      try {
        const budget = Math.min(5_000, verificationDeadline - Date.now() - 500)
        const [check] = await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(budget)}, true)`
          return tx.$queryRaw<{ blocker: string | null }[]>`
            SELECT public.verify_product_binary_week_readiness(${week}::date) AS blocker
          `
        }, { maxWait: 500, timeout: budget + 500 })
        if (check.blocker === 'Verification in progress') continue
        if (check.blocker) held++
        else verified++
        break
      } catch (error) {
        failed++
        console.error('[PRODUCT BINARY WEEKLY READINESS]', { week, error })
        break
      }
    }
  }

  const releases = await prisma.$queryRaw<{ week: string }[]>`
    SELECT to_char(week_start, 'YYYY-MM-DD') AS week FROM product_binary_pool_weeks
    WHERE closed_at IS NOT NULL AND released_at IS NULL
      AND CURRENT_TIMESTAMP >= (((week_start + 9) + time '10:00') AT TIME ZONE 'Asia/Manila')
      AND (readiness_blocker IS NULL OR readiness_checked_at <= CURRENT_TIMESTAMP - interval '5 minutes')
    ORDER BY week_start LIMIT 10
  `
  for (const { week } of releases) {
    while (releaseDeadline - Date.now() >= 2_000) {
      try {
        const remaining = Math.min(10_000, releaseDeadline - Date.now())
        const batchDeadline = Date.now() + remaining
        const result = await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(remaining - 1_000)}, true)`
          const [release] = await tx.$queryRaw<{ credited: number }[]>`
            SELECT public.release_product_binary_pool_week(${week}::date) AS credited
          `
          // Validate deferred ledger constraints inside the same bounded transaction.
          const validationBudget = batchDeadline - Date.now() - 500
          if (validationBudget <= 0) throw new Error('Weekly release exceeded its transaction budget.')
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(validationBudget)}, true)`
          await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`
          // A batch may retain expired allocations without crediting a wallet.
          // The database marks the week released only when no eligible work remains.
          const [state] = release.credited === 0 ? await tx.$queryRaw<{ complete: boolean }[]>`
            SELECT released_at IS NOT NULL AS complete
            FROM public.product_binary_pool_weeks WHERE week_start = ${week}::date
          ` : []
          return { credited: release.credited, complete: state?.complete === true }
        }, { maxWait: 1_000, timeout: remaining })
        if (result.credited < 0) {
          held++
          break
        }
        credited += result.credited
        if (result.complete) break
      } catch (error) {
        failed++
        console.error('[PRODUCT BINARY WEEKLY RELEASE]', error)
        break
      }
    }
  }
  const [backlog] = await prisma.$queryRaw<{ pending: number }[]>`
    SELECT COUNT(*)::int AS pending
    FROM product_binary_pool_allocations a JOIN product_binary_pool_weeks w USING (week_start)
    WHERE w.closed_at IS NOT NULL AND a.commission_id IS NULL AND a.amount_centavos > 0
        AND to_jsonb(a)->>'retained_at' IS NULL
  `
  return { closed, credited, failed, pending: backlog.pending, verified, held }
}
