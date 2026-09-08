import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import {
  MAINTENANCE_MESSAGE_KEY,
  MAINTENANCE_MODE_KEY,
  MAINTENANCE_SETTING_KEYS,
  MAINTENANCE_STARTED_AT_KEY,
  getMaintenanceState,
  parseMaintenanceState,
} from '@/app/lib/maintenanceMode'
import prisma from '@/app/lib/prisma'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === req.nextUrl.origin
  } catch {
    return false
  }
}

async function getOwnerAdmin() {
  const user = await getCurrentUser()
  return user?.role === 'admin' && user.is_staff !== true ? user : null
}

export async function GET() {
  try {
    const user = await getOwnerAdmin()
    if (!user) return NextResponse.json({ error: 'Admin owner access is required.' }, { status: 403 })
    return NextResponse.json(await getMaintenanceState(), { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('[ADMIN MAINTENANCE GET ERROR]', error)
    return NextResponse.json({ error: 'Unable to read maintenance status.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getOwnerAdmin()
    if (!user) return NextResponse.json({ error: 'Admin owner access is required.' }, { status: 403 })
    if (!isSameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 })
    }

    const body = await req.json() as { enabled?: unknown; message?: unknown; confirmation?: unknown }
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'A maintenance state is required.' }, { status: 400 })
    }

    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const confirmation = typeof body.confirmation === 'string' ? body.confirmation.trim().toUpperCase() : ''
    const requiredConfirmation = body.enabled ? 'MAINTENANCE' : 'RESUME'
    if (confirmation !== requiredConfirmation) {
      return NextResponse.json({ error: `Type ${requiredConfirmation} to confirm this action.` }, { status: 400 })
    }
    if (message.length < (body.enabled ? 10 : 3) || message.length > 500) {
      return NextResponse.json(
        { error: body.enabled ? 'Enter a clear maintenance notice (10–500 characters).' : 'Enter a completion note (3–500 characters).' },
        { status: 400 },
      )
    }

    const client = getClientInfo(req)
    const state = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hiroma-maintenance-mode'))`
      const rows = await tx.systemSetting.findMany({
        where: { key: { in: MAINTENANCE_SETTING_KEYS } },
        select: { key: true, value: true, updated_at: true, updated_by: true },
      })
      const previous = parseMaintenanceState(rows)
      if (previous.enabled === body.enabled) {
        throw new Error(body.enabled ? 'MAINTENANCE_ALREADY_ENABLED' : 'MAINTENANCE_ALREADY_DISABLED')
      }

      const now = new Date().toISOString()
      const values = [
        [MAINTENANCE_MODE_KEY, body.enabled ? 'on' : 'off'],
        [MAINTENANCE_MESSAGE_KEY, message],
        [MAINTENANCE_STARTED_AT_KEY, body.enabled ? now : ''],
      ] as const

      for (const [key, value] of values) {
        await tx.systemSetting.upsert({
          where: { key },
          create: { key, value, updated_by: user.id },
          update: { value, updated_by: user.id },
        })
      }

      await createRequiredAuditLog(tx, {
        user_id: user.id,
        user_name: user.full_name,
        user_role: user.role,
        member_id: formatMemberId(user.id, user.role),
        activity_type: body.enabled ? 'maintenance_mode_enabled' : 'maintenance_mode_disabled',
        category: 'admin',
        description: body.enabled
          ? `Admin owner enabled maintenance mode: ${message}`
          : `Admin owner resumed normal operations: ${message}`,
        metadata: {
          previous_enabled: previous.enabled,
          new_enabled: body.enabled,
          reason: message,
          changed_at: now,
        },
        ...client,
        risk_level: 'warning',
        status: 'completed',
      })

      return {
        enabled: body.enabled,
        message,
        startedAt: body.enabled ? now : null,
        updatedAt: now,
        updatedBy: user.id,
      }
    })

    return NextResponse.json({ success: true, state }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    if (error instanceof Error && error.message === 'MAINTENANCE_ALREADY_ENABLED') {
      return NextResponse.json({ error: 'Maintenance mode is already enabled. Refresh the page.' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'MAINTENANCE_ALREADY_DISABLED') {
      return NextResponse.json({ error: 'Maintenance mode is already disabled. Refresh the page.' }, { status: 409 })
    }
    console.error('[ADMIN MAINTENANCE PATCH ERROR]', error)
    return NextResponse.json({ error: 'Maintenance mode was not changed.' }, { status: 500 })
  }
}

