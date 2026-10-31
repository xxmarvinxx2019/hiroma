import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getProductPuExpiryMonths, validateProductPuExpiryMonths } from '@/app/lib/productPuExpiryPolicy'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ months: await getProductPuExpiryMonths(prisma) })
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin' || user.is_staff === true) {
    return NextResponse.json({ error: 'Only the admin owner can change Product PU expiry.' }, { status: 403 })
  }
  try {
    const body = await req.json()
    let months: number
    try { months = validateProductPuExpiryMonths(body.months) }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }) }
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('product-pu-expiry-policy'))`
      const previous = await getProductPuExpiryMonths(tx)
      await tx.$executeRaw`
        INSERT INTO system_settings(id,key,value,updated_at,updated_by)
        VALUES(gen_random_uuid(),'product_pu_expiry_months',${String(months)},CURRENT_TIMESTAMP,${user.id})
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=CURRENT_TIMESTAMP,updated_by=EXCLUDED.updated_by
      `
      await createRequiredAuditLog(tx, {
        user_id: user.id, user_name: user.full_name, user_role: user.role,
        activity_type: 'product_pu_expiry_policy_changed', category: 'commission',
        description: `Product PU expiry changed from ${previous} to ${months} months for newly credited PU.`,
        metadata: { previous_months: previous, months, applies_to: 'new_lots_only' },
        risk_level: 'high', status: 'completed', ...getClientInfo(req),
      })
    })
    return NextResponse.json({ success: true, months })
  } catch (error) {
    console.error('[PRODUCT PU EXPIRY POLICY]', error)
    return NextResponse.json({ error: 'Unable to save Product PU expiry.' }, { status: 500 })
  }
}
