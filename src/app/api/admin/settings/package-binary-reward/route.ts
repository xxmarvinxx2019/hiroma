import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getPackageRewardPolicy, validatePackageRewardPolicy, PACKAGE_REWARD_LOCK, PACKAGE_REWARD_POLICY_KEY } from '@/app/lib/packageBinaryReward'
import { verifyResellerSecurityPin, isSensitiveResellerPinAccepted, getSensitiveResellerPinFailure } from '@/app/lib/resellerSecurityPin'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'

async function owner() {
  const user = await getCurrentUser()
  return user?.role === 'admin' && user.is_staff !== true ? user : null
}

export async function GET() {
  if (!await owner()) return NextResponse.json({ error: 'Admin owner access is required.' }, { status: 403 })
  try {
    const [setup] = await prisma.$queryRaw<{ ready: boolean; claims_ready: boolean }[]>`
      SELECT to_regclass('public.package_binary_product_rewards') IS NOT NULL
        AND (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='binary_pair_events'
            AND column_name IN ('product_reward_pairs','reward_interval','reward_product_id','opening_reward_eligible_count'))=4 AS ready,
        to_regclass('public.product_reward_claim_allocations') IS NOT NULL AS claims_ready
    `
    if (!setup?.ready) {
      return NextResponse.json({
        error: 'Product rewards database setup is incomplete. Apply migration 20261028090000_package_binary_product_rewards to the intended database, then reload this page.',
        migration_required: '20261028090000_package_binary_product_rewards',
      }, { status: 503 })
    }
    if (!setup.claims_ready) return NextResponse.json({ error: 'Product Rewards claiming setup is pending. Apply migration 20261029090000_product_reward_claims, then reload.', migration_required: '20261029090000_product_reward_claims' }, { status: 503 })
    const [policy, products, [summary]] = await Promise.all([
      getPackageRewardPolicy(prisma),
      prisma.product.findMany({ where: { is_active: true, cost_price: { gt: 0 } }, select: { id: true, name: true, cost_price: true }, orderBy: { name: 'asc' } }),
      prisma.$queryRaw<{ bottles: number; company_cost: number }[]>`
        SELECT COALESCE(SUM(quantity),0)::int bottles, COALESCE(SUM(quantity*unit_cost_snapshot),0)::float company_cost
        FROM package_binary_product_rewards
      `,
    ])
    return NextResponse.json({ policy, products, summary })
  } catch (error) {
    console.error('[PACKAGE REWARD POLICY]', error)
    return NextResponse.json({ error: 'Unable to load product reward policy.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await owner()
  if (!user) return NextResponse.json({ error: 'Admin owner access is required.' }, { status: 403 })
  let body
  try {
    body = await req.json()
    validatePackageRewardPolicy(body.policy)
  } catch {
    return NextResponse.json({ error: 'Choose a reward bottle and a whole interval from 2 to 1000 pairs.' }, { status: 400 })
  }
  const policy = validatePackageRewardPolicy(body.policy)
  const pin = await verifyResellerSecurityPin(user.id, body.security_pin)
  if (!isSensitiveResellerPinAccepted(pin)) {
    const failure = getSensitiveResellerPinFailure(pin)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PACKAGE_REWARD_LOCK}))`
      if (policy.enabled) {
        const products = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM products WHERE id=${policy.product_id} AND is_active=true AND cost_price>0 FOR SHARE
        `
        if (!products.length) throw new Error('REWARD_PRODUCT_UNAVAILABLE')
      }
      const previous = await getPackageRewardPolicy(tx)
      await tx.$executeRaw`
        INSERT INTO system_settings(id,key,value,updated_at,updated_by)
        VALUES(gen_random_uuid(),${PACKAGE_REWARD_POLICY_KEY},${JSON.stringify(policy)},CURRENT_TIMESTAMP,${user.id})
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=CURRENT_TIMESTAMP,updated_by=EXCLUDED.updated_by
      `
      await createRequiredAuditLog(tx, {
        user_id: user.id, user_name: user.full_name, user_role: 'admin',
        activity_type: 'package_binary_product_reward_policy_changed', category: 'commission',
        description: `Package Binary product reward policy updated: ${policy.enabled ? `one bottle every ${policy.interval} eligible pairs` : 'disabled'}.`,
        metadata: { previous, policy }, risk_level: 'high', status: 'completed', ...getClientInfo(req),
      })
    })
    return NextResponse.json({ success: true, policy })
  } catch (error) {
    if (error instanceof Error && error.message === 'REWARD_PRODUCT_UNAVAILABLE') {
      return NextResponse.json({ error: 'Select an active reward bottle with a positive company cost.' }, { status: 400 })
    }
    console.error('[PACKAGE REWARD POLICY]', error)
    return NextResponse.json({ error: 'Unable to save product reward policy.' }, { status: 500 })
  }
}
