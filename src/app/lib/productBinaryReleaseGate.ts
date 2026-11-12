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
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('public.product_binary_pool_weeks')
        AND attname = 'release_started_at' AND NOT attisdropped
    ) AND to_regclass('public.product_binary_week_preparation') IS NOT NULL
      AND to_regprocedure('public.seal_closed_product_binary_allocation()') IS NOT NULL
      AND to_regprocedure('public.require_fully_funded_product_binary_pool_order()') IS NOT NULL
      AND to_regprocedure('public.track_product_binary_account_hold()') IS NOT NULL
      AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'public.queue_product_binary_pool_order(uuid,timestamptz,integer)',
        'public.close_product_binary_pool_week(date)',
        'public.verify_product_binary_week_readiness(date)',
        'public.release_product_binary_pool_week(date)',
        'public.retry_deferred_product_binary_credit(date,text)',
        'public.expire_deferred_product_binary_credits()',
        'public.product_binary_weekly_pair_eligible(text)'
      ]) AS required(signature)
      WHERE COALESCE(has_function_privilege(current_user, to_regprocedure(required.signature)::oid, 'EXECUTE'), false) = false
    )
      AND NOT COALESCE(has_function_privilege(current_user,
        to_regprocedure('public.credit_product_binary_pool_allocation(date,text)')::oid, 'EXECUTE'), true)
      AND EXISTS (
        SELECT 1 FROM public.system_settings
        WHERE key = 'product_binary_weekly_cutover'
          AND value::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
          AND EXTRACT(ISODOW FROM value::date) = 1
      ) AS ready
  `
  return state?.ready === true
}
