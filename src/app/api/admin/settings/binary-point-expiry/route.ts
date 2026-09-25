import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import {
  DEFAULT_BINARY_POINT_EXPIRY_YEARS,
  getBinaryPointExpiryYears,
  validateBinaryPointExpiryYears,
} from '@/app/lib/binaryPointExpiry'
import {
  getSensitiveResellerPinFailure,
  isSensitiveResellerPinAccepted,
  verifyResellerSecurityPin,
} from '@/app/lib/resellerSecurityPin'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

async function requireOwner() {
  const user = await getCurrentUser()
  return user?.role === 'admin' && user.is_staff !== true ? user : null
}

export async function GET() {
  const user = await requireOwner()
  if (!user) return NextResponse.json({ error: 'Admin owner access is required.' }, { status: 403 })
  const years = await prisma.$transaction((tx) => getBinaryPointExpiryYears(tx))
  const [summary] = await prisma.$queryRaw<{
    active_lots: number
    active_points: number
    expiring_next_90_days: number
    expired_points: number
    due_pending_points: number
  }[]>`
    SELECT
      (SELECT COUNT(*) FROM binary_point_lots WHERE remaining_points>0 AND expires_at>CURRENT_TIMESTAMP)::int active_lots,
      COALESCE((SELECT SUM(remaining_points) FROM binary_point_lots WHERE remaining_points>0 AND expires_at>CURRENT_TIMESTAMP),0)::int active_points,
      COALESCE((SELECT SUM(remaining_points) FROM binary_point_lots WHERE remaining_points>0 AND expires_at>CURRENT_TIMESTAMP AND expires_at<=CURRENT_TIMESTAMP+INTERVAL '90 days'),0)::int expiring_next_90_days,
      COALESCE((SELECT SUM(points) FROM binary_point_expirations),0)::int expired_points,
      COALESCE((SELECT SUM(remaining_points) FROM binary_point_lots WHERE remaining_points>0 AND expires_at<=CURRENT_TIMESTAMP),0)::int due_pending_points
  `
  return NextResponse.json({ years, default_years: DEFAULT_BINARY_POINT_EXPIRY_YEARS, summary })
}

export async function PATCH(req: NextRequest) {
  const user = await requireOwner()
  if (!user) return NextResponse.json({ error: 'Admin owner access is required.' }, { status: 403 })

  try {
    const body = await req.json()
    const years = validateBinaryPointExpiryYears(body.years)
    const pinVerification = await verifyResellerSecurityPin(user.id, body.security_pin)
    if (!isSensitiveResellerPinAccepted(pinVerification)) {
      const failure = getSensitiveResellerPinFailure(pinVerification)
      return NextResponse.json({ error: failure.error }, { status: failure.status })
    }

    const previous = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('binary-point-expiry-policy'))`
      const oldYears = await getBinaryPointExpiryYears(tx)
      await tx.$executeRaw`
        INSERT INTO system_settings (id,key,value,updated_at,updated_by)
        VALUES (gen_random_uuid(),'binary_point_expiry_years',${String(years)},CURRENT_TIMESTAMP,${user.id})
        ON CONFLICT (key) DO UPDATE SET value=${String(years)},updated_at=CURRENT_TIMESTAMP,updated_by=${user.id}
      `
      // Policy changes affect all points that have not already expired. Historical
      // expiration evidence remains immutable.
      await tx.$executeRaw`
        UPDATE binary_point_lots lot
        SET expires_at=lot.generated_at+make_interval(years=>${years}),
            expiry_years=${years}
        WHERE lot.remaining_points>0
          AND lot.expires_at>CURRENT_TIMESTAMP
          AND NOT EXISTS (SELECT 1 FROM binary_point_expirations e WHERE e.point_lot_id=lot.id)
      `
      await createRequiredAuditLog(tx, {
        user_id: user.id,
        user_name: user.full_name,
        user_role: 'admin',
        member_id: formatMemberId(user.id, 'admin'),
        activity_type: 'binary_point_expiry_policy_changed',
        category: 'commission',
        description: `Admin owner changed Package Binary unmatched-point expiry from ${oldYears} to ${years} years.`,
        metadata: { previous_years: oldYears, new_years: years },
        risk_level: 'high',
        status: 'completed',
        ...getClientInfo(req),
      })
      return oldYears
    })

    return NextResponse.json({
      success: true,
      previous_years: previous,
      years,
      message: 'Expiry policy updated. Due points expire in the daily job or before the member’s next pairing.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update point expiry.'
    const status = message.startsWith('Point expiry must') ? 400 : 500
    if (status === 500) console.error('[BINARY POINT EXPIRY SETTING]', error)
    return NextResponse.json({ error: message }, { status })
  }
}
