import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

async function requireAreaManager() {
  const user = await getCurrentUser()
  return user?.role === 'admin' && user.is_staff === true && user.staff_type === 'area_manager' && user.actor_id ? user : null
}

function assignedOwnerIds(permissions: readonly string[]) {
  return permissions.filter((permission) => permission.startsWith('area_branch:')).map((permission) => permission.slice('area_branch:'.length))
}

export async function GET() {
  const manager = await requireAreaManager()
  if (!manager) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const ownerIds = assignedOwnerIds(manager.permissions || [])
  const [branches, sessions] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ownerIds }, role: 'city', status: 'active', distributor_profile: { is: { dist_level: 'branch', is_active: true } } },
      orderBy: { full_name: 'asc' },
      select: {
        id: true, full_name: true, username: true,
        distributor_profile: { select: { dist_level: true, coverage_area: true, fulfillment_outlet_name: true, fulfillment_outlet_address: true } },
        inventory: { select: { quantity: true, product: { select: { name: true } } } },
      },
    }),
    prisma.inventoryAuditSession.findMany({
      where: { owner_id: { in: ownerIds } }, orderBy: { started_at: 'desc' }, take: 100,
      include: { items: { select: { counted_quantity: true, variance_quantity: true, variance_value: true } } },
    }),
  ])
  const sessionIds = sessions.map(({ id }) => id)
  const workflowEvents = sessionIds.length ? await prisma.inventoryAuditEvent.findMany({
    where: { reference_type: 'inventory_audit', reference_id: { in: sessionIds }, event_type: { in: ['physical_count_submitted', 'area_manager_surprise_count_submitted', 'area_manager_audit_verified'] } },
    orderBy: { created_at: 'asc' },
    select: { reference_id: true, event_type: true, actor_name_snapshot: true, created_at: true },
  }) : []
  const submittedBy = new Map(workflowEvents.filter(({ event_type }) => event_type.endsWith('_submitted')).map((event) => [event.reference_id, event]))
  const verifiedBy = new Map(workflowEvents.filter(({ event_type }) => event_type === 'area_manager_audit_verified').map((event) => [event.reference_id, event]))
  return NextResponse.json({
    branches: branches.map((branch) => ({ ...branch, inventory: undefined, product_count: branch.inventory.length, units_on_hand: branch.inventory.reduce((sum, item) => sum + item.quantity, 0) })),
    sessions: sessions.map((session) => ({
      id: session.id, owner_id: session.owner_id, reference_number: session.reference_number, status: session.status,
      started_by: session.started_by_name_snapshot, submitted_by: submittedBy.get(session.id)?.actor_name_snapshot || null,
      started_at: session.started_at, submitted_at: session.submitted_at, approved_at: session.approved_at,
      verified_at: verifiedBy.get(session.id)?.created_at || null, verified_by: verifiedBy.get(session.id)?.actor_name_snapshot || null,
      totals: {
        products: session.items.length,
        counted: session.items.filter(({ counted_quantity }) => counted_quantity !== null).length,
        variance_units: session.items.reduce((sum, item) => sum + Math.abs(item.variance_quantity || 0), 0),
        variance_value: session.items.reduce((sum, item) => sum + Math.abs(Number(item.variance_value || 0)), 0),
      },
    })),
  })
}

export async function POST(req: NextRequest) {
  try {
    const manager = await requireAreaManager()
    if (!manager) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const body = await req.json()
    const ownerId = typeof body.owner_id === 'string' ? body.owner_id : ''
    if (!assignedOwnerIds(manager.permissions || []).includes(ownerId)) return NextResponse.json({ error: 'This Hiroma Branch is not assigned to your account.' }, { status: 403 })
    const owner = await prisma.user.findFirst({ where: { id: ownerId, role: 'city', status: 'active', distributor_profile: { is: { dist_level: 'branch', is_active: true } } }, select: { id: true, distributor_profile: { select: { dist_level: true } } } })
    if (!owner) return NextResponse.json({ error: 'Assigned location is unavailable.' }, { status: 404 })
    const open = await prisma.inventoryAuditSession.findFirst({ where: { owner_id: ownerId, status: { in: ['counting', 'submitted'] } }, select: { id: true, reference_number: true, status: true } })
    if (open) return NextResponse.json({ error: `Audit ${open.reference_number} is still ${open.status}. It must be completed first.`, session_id: open.id }, { status: 409 })
    const inventory = await prisma.inventory.findMany({ where: { owner_id: ownerId }, orderBy: { product: { name: 'asc' } }, include: { product: { select: { name: true, cost_price: true, city_price: true, branch_price: true } } } })
    if (!inventory.length) return NextResponse.json({ error: 'This location has no inventory products to count.' }, { status: 400 })
    const reference = `AUD-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`
    const actorName = manager.actor_name || manager.full_name
    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.inventoryAuditSession.create({
        data: {
          reference_number: reference, owner_id: ownerId, started_by: manager.actor_id!, started_by_name_snapshot: actorName,
          notes: 'Area Manager surprise physical inventory audit',
          items: { create: inventory.map((item) => ({ inventory_id: item.id, product_id: item.product_id, product_name_snapshot: item.product.name, expected_quantity: item.quantity, unit_cost_snapshot: new Prisma.Decimal((owner.distributor_profile?.dist_level === 'branch' ? Number(item.product.branch_price) : Number(item.product.city_price)) || Number(item.product.cost_price)) })) },
        },
      })
      await tx.inventoryAuditEvent.create({ data: { owner_id: ownerId, actor_id: manager.actor_id, actor_name_snapshot: actorName, event_type: 'area_manager_surprise_count_started', reference_type: 'inventory_audit', reference_id: session.id, reason: 'Area Manager surprise physical inventory audit', metadata: { reference_number: reference, product_count: inventory.length } } })
      return session
    })
    return NextResponse.json({ success: true, session_id: created.id, reference_number: reference }, { status: 201 })
  } catch (error) {
    console.error('[AREA MANAGER AUDIT START]', error)
    return NextResponse.json({ error: 'Unable to start the surprise audit.' }, { status: 500 })
  }
}
