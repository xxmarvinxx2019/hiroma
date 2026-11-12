import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'
import prisma from '@/app/lib/prisma'
import { getProductBinaryPairAmount, isProductBinaryPairAmount, PRODUCT_BINARY_AMOUNT_KEY, getProductBinaryPuPerLeg, isProductBinaryPuPerLeg, PRODUCT_BINARY_MATCH_KEY } from '@/app/lib/productBinaryMatchPolicy'
import { getSensitiveResellerPinFailure, isSensitiveResellerPinAccepted, verifyResellerSecurityPin } from '@/app/lib/resellerSecurityPin'

async function getOwner() {
  const user = await getCurrentUser()
  return user?.role === 'admin' && user.is_staff !== true ? user : null
}

export async function GET() {
  if (!await getOwner()) return NextResponse.json({ error: 'Admin owner access is required.' }, { status: 403 })
  return NextResponse.json({ puPerLeg: await getProductBinaryPuPerLeg(prisma), pairAmount: await getProductBinaryPairAmount(prisma) }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function PATCH(req: NextRequest) {
  const user = await getOwner()
  if (!user || req.headers.get('origin') !== req.nextUrl.origin) {
    return NextResponse.json({ error: 'Admin owner access and a valid request origin are required.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const puPerLeg: unknown = body?.puPerLeg
  if (!isProductBinaryPuPerLeg(puPerLeg)) {
    return NextResponse.json({ error: 'Enter a valid positive whole number of PU per leg.' }, { status: 400 })
  }

  const pairAmount: unknown = body?.pairAmount
  if (!isProductBinaryPairAmount(pairAmount)) {
    return NextResponse.json({ error: 'Use a payout from PHP 0.50 to PHP 20 in PHP 0.50 increments.' }, { status: 400 })
  }
  const [schema] = await prisma.$queryRaw<{ ready: boolean }[]>`
    SELECT to_regprocedure('public.product_binary_pair_amount()') IS NOT NULL AS ready
  `
  if (!schema.ready) return NextResponse.json({ error: 'Apply the Product Binary rate migration before saving.' }, { status: 503 })

  const pin = await verifyResellerSecurityPin(user.id, body.securityPin)
  if (!isSensitiveResellerPinAccepted(pin)) {
    const failure = getSensitiveResellerPinFailure(pin)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }

  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PRODUCT_BINARY_MATCH_KEY}))`
    const previous = await getProductBinaryPuPerLeg(tx)
    const previousAmount = await getProductBinaryPairAmount(tx)
    if (previous === puPerLeg && previousAmount === pairAmount) return

    const value = String(puPerLeg)
    await tx.systemSetting.upsert({
      where: { key: PRODUCT_BINARY_MATCH_KEY },
      create: { key: PRODUCT_BINARY_MATCH_KEY, value, updated_by: user.id },
      update: { value, updated_by: user.id },
    })
    await tx.systemSetting.upsert({
      where: { key: PRODUCT_BINARY_AMOUNT_KEY },
      create: { key: PRODUCT_BINARY_AMOUNT_KEY, value: String(pairAmount), updated_by: user.id },
      update: { value: String(pairAmount), updated_by: user.id },
    })
    await createRequiredAuditLog(tx, {
      user_id: user.id,
      user_name: user.full_name,
      user_role: 'admin',
      activity_type: 'product_binary_policy_changed',
      category: 'commission',
      description: `Set Product Binary to ${puPerLeg} PU per leg and a maximum of PHP ${pairAmount} per pair.`,
      metadata: { previous, puPerLeg, previousAmount, pairAmount },
      risk_level: 'high',
      status: 'completed',
      ...getClientInfo(req),
    })
  })
  return NextResponse.json({ puPerLeg, pairAmount })
}
