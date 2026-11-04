import type { Prisma } from '@prisma/client'

export function requiresProductBinaryReleaseApproval() {
  return process.env.VERCEL_ENV === 'production' ||
    (!process.env.VERCEL_ENV && process.env.NODE_ENV === 'production')
}

export async function isProductBinaryReleaseApproved(db: Pick<Prisma.TransactionClient, '$queryRaw'>) {
  if (!requiresProductBinaryReleaseApproval()) return true

  const deployedSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.HIROMA_RELEASE_SHA
  if (!deployedSha || !/^[a-f0-9]{40}$/.test(deployedSha) ||
      deployedSha !== process.env.PRODUCT_BINARY_APPROVED_RELEASE_SHA) return false

  const [state] = await db.$queryRaw<{ ready: boolean }[]>`
    SELECT to_regprocedure('public.release_product_binary_pool_week(date)') IS NOT NULL
      AND to_regprocedure('public.queue_product_binary_pool_order(uuid,timestamptz,integer)') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.system_settings
        WHERE key = 'product_binary_weekly_cutover'
          AND value::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
          AND EXTRACT(ISODOW FROM value::date) = 1
      ) AS ready
  `
  return state?.ready === true
}
