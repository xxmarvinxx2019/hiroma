import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import { canViewCityDashboardFinancials } from '@/app/lib/cityDashboardAccess'
import prisma from '@/app/lib/prisma'

function actor(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  return {
    id: user.actor_id || user.id,
    name: user.actor_name || user.full_name || user.username,
  }
}

function referenceNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `AUD-${date}-${randomBytes(3).toString('hex').toUpperCase()}`
}

async function requireCity() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return null
  return user
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireCity()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const canViewFinancials = canViewCityDashboardFinancials(user)

    const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 20)))
    const sessions = await prisma.inventoryAuditSession.findMany({
      where: { owner_id: user.id },
      orderBy: { started_at: 'desc' },
      take: limit,
      include: { items: { select: { counted_quantity: true, variance_quantity: true, variance_value: true } } },
    })
    const sessionIds = sessions.map(({ id }) => id)
    const workflowEvents = sessionIds.length ? await prisma.inventoryAuditEvent.findMany({
      where: { reference_type: 'inventory_audit', reference_id: { in: sessionIds }, event_type: { in: ['physical_count_submitted', 'area_manager_surprise_count_submitted', 'area_manager_audit_verified'] } },
      orderBy: { created_at: 'desc' },
      select: { reference_id: true, event_type: true, actor_name_snapshot: true, created_at: true },
    }) : []
    const submittedBy = new Map(workflowEvents.filter(({ event_type }) => event_type.endsWith('_submitted')).map((event) => [event.reference_id, event]))
    const verifiedBy = new Map(workflowEvents.filter(({ event_type }) => event_type === 'area_manager_audit_verified').map((event) => [event.reference_id, event]))

    const data = sessions.map((session) => {
      const counted = session.items.filter((item) => item.counted_quantity !== null).length
      const varianceUnits = session.items.reduce((sum, item) => sum + Math.abs(item.variance_quantity || 0), 0)
      const varianceValue = session.items.reduce((sum, item) => sum + Math.abs(Number(item.variance_value || 0)), 0)
      return {
        id: session.id,
        reference_number: session.reference_number,
        status: session.status,
        scope: session.scope,
        started_by: session.started_by_name_snapshot,
        notes: session.notes,
        started_at: session.started_at,
        submitted_at: session.submitted_at,
        submitted_by: submittedBy.get(session.id)?.actor_name_snapshot || null,
        approved_at: session.approved_at,
        approval_notes: session.approval_notes,
        verified_at: verifiedBy.get(session.id)?.created_at || null,
        verified_by: verifiedBy.get(session.id)?.actor_name_snapshot || null,
        totals: {
          products: session.items.length,
          counted,
          variance_units: varianceUnits,
          variance_value: canViewFinancials ? varianceValue : null,
        },
      }
    })

    const canApprove = user.is_staff !== true || user.permissions?.includes('pos_approve') === true
    return NextResponse.json({
      sessions: data,
      can_approve: canApprove,
      access: { can_view_financials: canViewFinancials },
    })
  } catch (error) {
    console.error('[INVENTORY AUDITS GET]', error)
    return NextResponse.json({ error: 'Unable to load inventory audits.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireCity()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : null
    const currentActor = actor(user)

    const open = await prisma.inventoryAuditSession.findFirst({
      where: { owner_id: user.id, status: { in: ['counting', 'submitted'] } },
      select: { id: true, reference_number: true, status: true },
    })
    if (open) {
      return NextResponse.json({ error: `Audit ${open.reference_number} is still ${open.status}. Finish it before starting another count.`, session_id: open.id }, { status: 409 })
    }

    const inventory = await prisma.inventory.findMany({
      where: { owner_id: user.id },
      orderBy: { product: { name: 'asc' } },
      include: { product: { select: { name: true, cost_price: true, city_price: true, branch_price: true } } },
    })
    if (inventory.length === 0) return NextResponse.json({ error: 'There are no inventory products to count.' }, { status: 400 })

    const profile = await prisma.distributorProfile.findUnique({ where: { user_id: user.id }, select: { dist_level: true } })
    const isBranch = profile?.dist_level === 'branch'
    const ref = referenceNumber()

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.inventoryAuditSession.create({
        data: {
          reference_number: ref,
          owner_id: user.id,
          started_by: currentActor.id,
          started_by_name_snapshot: currentActor.name,
          notes,
          items: {
            create: inventory.map((item) => ({
              inventory_id: item.id,
              product_id: item.product_id,
              product_name_snapshot: item.product.name,
              expected_quantity: item.quantity,
              unit_cost_snapshot: new Prisma.Decimal(
                (isBranch ? Number(item.product.branch_price) : Number(item.product.city_price)) || Number(item.product.cost_price),
              ),
            })),
          },
        },
      })
      await tx.inventoryAuditEvent.create({
        data: {
          owner_id: user.id,
          actor_id: currentActor.id,
          actor_name_snapshot: currentActor.name,
          event_type: 'physical_count_started',
          reference_type: 'inventory_audit',
          reference_id: created.id,
          reason: notes || 'Physical inventory count started',
          metadata: { reference_number: ref, product_count: inventory.length },
        },
      })
      return created
    })

    return NextResponse.json({ success: true, session_id: session.id, reference_number: ref }, { status: 201 })
  } catch (error) {
    console.error('[INVENTORY AUDITS POST]', error)
    return NextResponse.json({ error: 'Unable to start the physical count.' }, { status: 500 })
  }
}
