import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

type Context = { params: Promise<{ id: string }> }
type CountInput = { id?: unknown; counted_quantity?: unknown; damaged_quantity?: unknown; expired_quantity?: unknown; notes?: unknown }
const integer = (value: unknown) => { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 ? parsed : null }

async function contextFor(id: string) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin' || user.is_staff !== true || user.staff_type !== 'area_manager' || !user.actor_id) return null
  const session = await prisma.inventoryAuditSession.findUnique({ where: { id }, include: { items: { orderBy: { product_name_snapshot: 'asc' } } } })
  if (!session) return null
  const assigned = (user.permissions || []).includes(`area_branch:${session.owner_id}`)
  if (!assigned) return null
  const branch = await prisma.user.findFirst({ where: { id: session.owner_id, role: 'city', status: 'active', distributor_profile: { is: { dist_level: 'branch', is_active: true } } }, select: { id: true } })
  return branch ? { user, session } : null
}

export async function GET(_req: NextRequest, { params }: Context) {
  const { id } = await params
  const access = await contextFor(id)
  if (!access) return NextResponse.json({ error: 'Audit not found or not assigned.' }, { status: 404 })
  const workflowEvents = await prisma.inventoryAuditEvent.findMany({ where: { reference_type: 'inventory_audit', reference_id: id, event_type: { in: ['physical_count_submitted', 'area_manager_surprise_count_submitted', 'area_manager_audit_verified'] } }, orderBy: { created_at: 'asc' }, select: { event_type: true, actor_name_snapshot: true, created_at: true, reason: true } })
  const submission = workflowEvents.filter(({ event_type }) => event_type.endsWith('_submitted')).at(-1)
  const verification = workflowEvents.filter(({ event_type }) => event_type === 'area_manager_audit_verified').at(-1)
  return NextResponse.json({ session: { ...access.session, submitted_by: submission?.actor_name_snapshot || null, verified_at: verification?.created_at || null, verified_by: verification?.actor_name_snapshot || null, verification_notes: verification?.reason || null, items: access.session.items.map((item) => ({ ...item, unit_cost_snapshot: Number(item.unit_cost_snapshot), variance_value: Number(item.variance_value || 0) })) } })
}

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params
    const access = await contextFor(id)
    if (!access) return NextResponse.json({ error: 'Audit not found or not assigned.' }, { status: 404 })
    const { user, session } = access
    const body = await req.json()
    const action = typeof body.action === 'string' ? body.action : ''
    const actorName = user.actor_name || user.full_name
    if (action === 'cancel') {
      if (session.started_by !== user.actor_id) return NextResponse.json({ error: 'Only the Area Manager who started this audit can cancel it.' }, { status: 403 })
      if (session.status !== 'counting') return NextResponse.json({ error: 'Only an active counting session can be cancelled.' }, { status: 409 })
      await prisma.$transaction([
        prisma.inventoryAuditSession.update({ where: { id }, data: { status: 'cancelled', approved_at: new Date(), approved_by: user.actor_id, approval_notes: 'Cancelled by Area Manager before submission' } }),
        prisma.inventoryAuditEvent.create({ data: { owner_id: session.owner_id, actor_id: user.actor_id, actor_name_snapshot: actorName, event_type: 'area_manager_surprise_count_cancelled', reference_type: 'inventory_audit', reference_id: id, reason: 'Area Manager cancelled the surprise count before submission', metadata: { reference_number: session.reference_number } } }),
      ])
      return NextResponse.json({ success: true, status: 'cancelled' })
    }
    if (action === 'save_counts' || action === 'submit') {
      if (session.started_by !== user.actor_id) return NextResponse.json({ error: 'Only the Area Manager who started this surprise audit can enter its findings.' }, { status: 403 })
      if (session.status !== 'counting') return NextResponse.json({ error: 'Only an active counting session can be updated.' }, { status: 409 })
      if (!Array.isArray(body.items)) return NextResponse.json({ error: 'Counted items are required.' }, { status: 400 })
      const allowed = new Map(session.items.map((item) => [item.id, item]))
      const updates = [] as Array<{ item: typeof session.items[number]; counted: number; damaged: number; expired: number; variance: number; missing: number; notes: string | null }>
      for (const raw of body.items as CountInput[]) {
        if (typeof raw.id !== 'string' || !allowed.has(raw.id)) return NextResponse.json({ error: 'An audit item does not belong to this session.' }, { status: 400 })
        const item = allowed.get(raw.id)!; const counted = integer(raw.counted_quantity); const damaged = integer(raw.damaged_quantity) ?? 0; const expired = integer(raw.expired_quantity) ?? 0
        if (counted === null) return NextResponse.json({ error: `${item.product_name_snapshot}: enter a whole-number physical count.` }, { status: 400 })
        if (damaged + expired > counted) return NextResponse.json({ error: `${item.product_name_snapshot}: damaged and expired cannot exceed physical count.` }, { status: 400 })
        updates.push({ item, counted, damaged, expired, variance: counted - damaged - expired - item.expected_quantity, missing: Math.max(0, item.expected_quantity - counted), notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 1000) || null : null })
      }
      if (action === 'submit' && updates.length !== session.items.length) return NextResponse.json({ error: 'Every product must be counted before submission.' }, { status: 400 })
      await prisma.$transaction(async (tx) => {
        for (const update of updates) await tx.inventoryAuditItem.update({ where: { id: update.item.id }, data: { counted_quantity: update.counted, damaged_quantity: update.damaged, expired_quantity: update.expired, missing_quantity: update.missing, variance_quantity: update.variance, variance_value: new Prisma.Decimal(update.variance * Number(update.item.unit_cost_snapshot)), notes: update.notes, counted_by: user.actor_id, counted_at: new Date() } })
        if (action === 'submit') {
          await tx.inventoryAuditSession.update({ where: { id }, data: { status: 'submitted', submitted_at: new Date() } })
          await tx.inventoryAuditEvent.create({ data: { owner_id: session.owner_id, actor_id: user.actor_id, actor_name_snapshot: actorName, event_type: 'area_manager_surprise_count_submitted', reference_type: 'inventory_audit', reference_id: id, reason: 'Surprise count submitted to the local owner/manager for reconciliation', metadata: { reference_number: session.reference_number } } })
        }
      })
      return NextResponse.json({ success: true, status: action === 'submit' ? 'submitted' : 'counting' })
    }
    if (action === 'verify') {
      if (session.status !== 'approved') return NextResponse.json({ error: 'Only an approved reconciliation can be verified.' }, { status: 409 })
      const existingVerification = await prisma.inventoryAuditEvent.findFirst({ where: { reference_type: 'inventory_audit', reference_id: id, event_type: 'area_manager_audit_verified' }, select: { id: true } })
      if (existingVerification) return NextResponse.json({ error: 'This audit has already been verified.' }, { status: 409 })
      const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : ''
      if (notes.length < 5) return NextResponse.json({ error: 'Enter a verification note of at least 5 characters.' }, { status: 400 })
      await prisma.inventoryAuditEvent.create({ data: { owner_id: session.owner_id, actor_id: user.actor_id, actor_name_snapshot: actorName, event_type: 'area_manager_audit_verified', reference_type: 'inventory_audit', reference_id: id, reason: notes, metadata: { reference_number: session.reference_number } } })
      return NextResponse.json({ success: true, status: 'verified' })
    }
    return NextResponse.json({ error: 'Unsupported audit action.' }, { status: 400 })
  } catch (error) {
    console.error('[AREA MANAGER AUDIT UPDATE]', error)
    return NextResponse.json({ error: 'Unable to update this surprise audit.' }, { status: 500 })
  }
}
