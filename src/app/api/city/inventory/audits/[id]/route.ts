import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { canLocalAccountCount, canLocalOwnerReview } from '@/app/lib/inventoryAuditPolicy'

type CountInput = {
  id?: unknown
  counted_quantity?: unknown
  damaged_quantity?: unknown
  expired_quantity?: unknown
  notes?: unknown
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function actor(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  return { id: user.actor_id || user.id, name: user.actor_name || user.full_name || user.username }
}

function isAuthorizedApprover(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  return user.is_staff !== true || user.permissions?.includes('pos_approve') === true
}

async function sessionForOwner(id: string, ownerId: string) {
  return prisma.inventoryAuditSession.findFirst({
    where: { id, owner_id: ownerId },
    include: { items: { orderBy: { product_name_snapshot: 'asc' } } },
  })
}

async function submissionForSession(id: string) {
  return prisma.inventoryAuditEvent.findFirst({
    where: { reference_type: 'inventory_audit', reference_id: id, event_type: { in: ['physical_count_submitted', 'area_manager_surprise_count_submitted', 'shift_closing_count_submitted'] } },
    orderBy: { created_at: 'desc' },
    select: { actor_id: true, actor_name_snapshot: true },
  })
}

type AuditRouteContext = { params: Promise<{ id: string }> }

class InventoryAuditConflictError extends Error {}

export async function GET(_req: NextRequest, context: AuditRouteContext) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await context.params
    const session = await sessionForOwner(id, user.id)
    if (!session) return NextResponse.json({ error: 'Audit session not found.' }, { status: 404 })
    const starter = await prisma.staffProfile.findUnique({ where: { user_id: session.started_by }, select: { staff_type: true } })
    const areaManagerAudit = starter?.staff_type === 'area_manager'
    const submission = await submissionForSession(id)
    return NextResponse.json({
      session: {
        ...session,
        items: session.items.map((item) => ({ ...item, unit_cost_snapshot: Number(item.unit_cost_snapshot), variance_value: Number(item.variance_value || 0) })),
      },
      can_count: canLocalAccountCount(user.is_staff === true, starter?.staff_type),
      is_area_manager_audit: areaManagerAudit,
      can_approve: canLocalOwnerReview({ isAuthorizedApprover: isAuthorizedApprover(user), status: session.status, submitterId: submission?.actor_id, starterId: session.started_by, actorId: actor(user).id }),
    })
  } catch (error) {
    console.error('[INVENTORY AUDIT DETAIL GET]', error)
    return NextResponse.json({ error: 'Unable to load this audit.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: AuditRouteContext) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await context.params
    const body = await req.json()
    const action = typeof body.action === 'string' ? body.action : ''
    const currentActor = actor(user)
    const session = await sessionForOwner(id, user.id)
    if (!session) return NextResponse.json({ error: 'Audit session not found.' }, { status: 404 })

    if (action === 'save_counts' || action === 'submit') {
      if (session.status !== 'counting') return NextResponse.json({ error: 'Only an active counting session can be updated.' }, { status: 409 })
      const starter = await prisma.staffProfile.findUnique({ where: { user_id: session.started_by }, select: { staff_type: true } })
      if (!canLocalAccountCount(user.is_staff === true, starter?.staff_type)) return NextResponse.json({ error: starter?.staff_type === 'area_manager' ? 'This surprise audit is controlled by the assigned Area Manager. Local accounts can review it after submission.' : 'For accountability, the City/Branch owner cannot encode or submit a count they may approve. Assign an inventory staff member to complete this audit.' }, { status: 403 })
      if (!Array.isArray(body.items)) return NextResponse.json({ error: 'Counted items are required.' }, { status: 400 })
      const allowed = new Map(session.items.map((item) => [item.id, item]))
      const updates: Array<{ item: typeof session.items[number]; counted: number; damaged: number; expired: number; missing: number; saleable: number; variance: number; notes: string | null }> = []

      for (const raw of body.items as CountInput[]) {
        if (typeof raw.id !== 'string' || !allowed.has(raw.id)) return NextResponse.json({ error: 'An audit item does not belong to this session.' }, { status: 400 })
        const item = allowed.get(raw.id)!
        const counted = nonNegativeInteger(raw.counted_quantity)
        const damaged = nonNegativeInteger(raw.damaged_quantity) ?? 0
        const expired = nonNegativeInteger(raw.expired_quantity) ?? 0
        if (counted === null) return NextResponse.json({ error: `${item.product_name_snapshot}: physical count must be a whole number.` }, { status: 400 })
        if (damaged + expired > counted) return NextResponse.json({ error: `${item.product_name_snapshot}: damaged and expired units cannot exceed the physical count.` }, { status: 400 })
        const saleable = counted - damaged - expired
        const variance = saleable - item.expected_quantity
        updates.push({
          item,
          counted,
          damaged,
          expired,
          missing: Math.max(0, item.expected_quantity - counted),
          saleable,
          variance,
          notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 1000) || null : null,
        })
      }

      if (action === 'submit' && updates.length !== session.items.length) {
        return NextResponse.json({ error: 'Every product must be physically counted before submission.' }, { status: 400 })
      }

      await prisma.$transaction(async (tx) => {
        for (const update of updates) {
          await tx.inventoryAuditItem.update({
            where: { id: update.item.id },
            data: {
              counted_quantity: update.counted,
              damaged_quantity: update.damaged,
              expired_quantity: update.expired,
              missing_quantity: update.missing,
              variance_quantity: update.variance,
              variance_value: new Prisma.Decimal(update.variance * Number(update.item.unit_cost_snapshot)),
              notes: update.notes,
              counted_by: currentActor.id,
              counted_at: new Date(),
            },
          })
        }
        if (action === 'submit') {
          await tx.inventoryAuditSession.update({ where: { id }, data: { status: 'submitted', submitted_at: new Date() } })
          await tx.inventoryAuditEvent.create({
            data: {
              owner_id: user.id,
              actor_id: currentActor.id,
              actor_name_snapshot: currentActor.name,
              event_type: 'physical_count_submitted',
              reference_type: 'inventory_audit',
              reference_id: id,
              reason: 'Physical count submitted for owner approval',
              metadata: { reference_number: session.reference_number, products: updates.length },
            },
          })
        }
      })
      return NextResponse.json({ success: true, status: action === 'submit' ? 'submitted' : 'counting' })
    }

    if (action === 'approve') {
      if (!isAuthorizedApprover(user)) return NextResponse.json({ error: 'Only the City Distributor, Branch owner, or assigned Operations Approver can approve inventory adjustments.' }, { status: 403 })
      if (session.status !== 'submitted') return NextResponse.json({ error: 'Only submitted counts can be approved.' }, { status: 409 })
      const submission = await submissionForSession(id)
      if (!canLocalOwnerReview({ isAuthorizedApprover: true, status: session.status, submitterId: submission?.actor_id, starterId: session.started_by, actorId: currentActor.id })) return NextResponse.json({ error: 'You cannot approve your own submitted count. A different authorized owner, manager, or Operations Approver must review it.' }, { status: 403 })
      if (session.items.some((item) => item.counted_quantity === null || item.variance_quantity === null)) return NextResponse.json({ error: 'This count is incomplete.' }, { status: 409 })
      const approvalNotes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) || null : null
      const linkedShift = session.pos_shift_id ? await prisma.posShift.findFirst({ where: { id: session.pos_shift_id, owner_id: user.id }, select: { variance_snapshot: true } }) : null
      const hasVariance = session.items.some((item) => item.variance_quantity !== 0) || Math.abs(Number(linkedShift?.variance_snapshot || 0)) >= 0.005
      if (hasVariance && (!approvalNotes || approvalNotes.length < 5)) {
        return NextResponse.json({ error: 'Verification notes are required before approving a count with a shortage or overage.' }, { status: 400 })
      }

      await prisma.$transaction(async (tx) => {
        const claimed = await tx.inventoryAuditSession.updateMany({
          where: { id, owner_id: user.id, status: 'submitted' },
          data: { status: 'approved', approved_at: new Date(), approved_by: currentActor.id, approval_notes: approvalNotes },
        })
        if (claimed.count !== 1) throw new InventoryAuditConflictError('This audit was already reviewed. Refresh to see its latest status.')

        for (const item of session.items) {
          const current = await tx.inventory.findFirst({ where: { id: item.inventory_id, owner_id: user.id } })
          if (!current) throw new Error(`Inventory item ${item.product_name_snapshot} no longer exists.`)
          if (current.quantity !== item.expected_quantity) {
            throw new InventoryAuditConflictError(`${item.product_name_snapshot} changed from ${item.expected_quantity} to ${current.quantity} while the count was open. Reject and restart the count to avoid overwriting legitimate stock movement.`)
          }
          const saleable = item.counted_quantity! - item.damaged_quantity - item.expired_quantity
          const reconciled = await tx.inventory.updateMany({
            where: { id: current.id, owner_id: user.id, quantity: item.expected_quantity },
            data: { quantity: saleable },
          })
          if (reconciled.count !== 1) throw new InventoryAuditConflictError(`${item.product_name_snapshot} changed while this audit was being approved. No inventory adjustment was saved; refresh and restart the count.`)
          await tx.inventoryAuditEvent.create({
            data: {
              owner_id: user.id,
              product_id: item.product_id,
              actor_id: currentActor.id,
              actor_name_snapshot: currentActor.name,
              event_type: saleable === current.quantity ? 'physical_count_confirmed' : 'physical_count_adjustment',
              quantity_delta: saleable - current.quantity,
              quantity_before: current.quantity,
              quantity_after: saleable,
              unit_cost_snapshot: item.unit_cost_snapshot,
              total_value: new Prisma.Decimal((saleable - current.quantity) * Number(item.unit_cost_snapshot)),
              reference_type: 'inventory_audit',
              reference_id: id,
              reason: item.notes || approvalNotes || 'Approved physical inventory count',
              metadata: {
                reference_number: session.reference_number,
                physical_count: item.counted_quantity,
                damaged: item.damaged_quantity,
                expired: item.expired_quantity,
                missing: item.missing_quantity,
              },
            },
          })
        }
        if (session.pos_shift_id) {
          const finalized = await tx.posShift.updateMany({
            where: { id: session.pos_shift_id, owner_id: user.id, status: 'locally_closed' },
            data: { status: 'finalized', active_terminal_key: null, closed_by_id: currentActor.id, server_finalized_at: new Date() },
          })
          if (finalized.count !== 1) throw new InventoryAuditConflictError('The linked cashier shift is no longer awaiting approval. Refresh before reviewing it again.')
        }
      })
      return NextResponse.json({ success: true, status: 'approved' })
    }

    if (action === 'cancel') {
      if (session.status !== 'counting') return NextResponse.json({ error: 'Only an active counting session can be cancelled.' }, { status: 409 })
      const starter = await prisma.staffProfile.findUnique({ where: { user_id: session.started_by }, select: { staff_type: true } })
      if (starter?.staff_type === 'area_manager') return NextResponse.json({ error: 'Only the assigned Area Manager can cancel this surprise audit.' }, { status: 403 })
      const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : ''
      await prisma.$transaction([
        prisma.inventoryAuditSession.update({
          where: { id },
          data: { status: 'cancelled', approved_at: new Date(), approved_by: currentActor.id, approval_notes: notes || 'Counting session cancelled before submission' },
        }),
        prisma.inventoryAuditEvent.create({
          data: {
            owner_id: user.id,
            actor_id: currentActor.id,
            actor_name_snapshot: currentActor.name,
            event_type: 'physical_count_cancelled',
            reference_type: 'inventory_audit',
            reference_id: id,
            reason: notes || 'Counting session cancelled before submission',
            metadata: { reference_number: session.reference_number },
          },
        }),
      ])
      return NextResponse.json({ success: true, status: 'cancelled' })
    }

    if (action === 'reject') {
      if (!isAuthorizedApprover(user)) return NextResponse.json({ error: 'Only the owner, manager, or assigned Operations Approver can reject a submitted inventory count.' }, { status: 403 })
      if (session.status !== 'submitted') return NextResponse.json({ error: 'Only submitted counts can be rejected.' }, { status: 409 })
      const submission = await submissionForSession(id)
      if (!canLocalOwnerReview({ isAuthorizedApprover: true, status: session.status, submitterId: submission?.actor_id, starterId: session.started_by, actorId: currentActor.id })) return NextResponse.json({ error: 'You cannot reject your own submitted count.' }, { status: 403 })
      const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : ''
      if (notes.length < 5) return NextResponse.json({ error: 'A rejection reason is required.' }, { status: 400 })
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.inventoryAuditSession.updateMany({
          where: { id, owner_id: user.id, status: 'submitted' },
          data: { status: 'rejected', approved_at: new Date(), approved_by: currentActor.id, approval_notes: notes },
        })
        if (claimed.count !== 1) throw new InventoryAuditConflictError('This audit was already reviewed. Refresh to see its latest status.')
        await tx.inventoryAuditEvent.create({ data: { owner_id: user.id, actor_id: currentActor.id, actor_name_snapshot: currentActor.name, event_type: 'physical_count_rejected', reference_type: 'inventory_audit', reference_id: id, reason: notes, metadata: { reference_number: session.reference_number } } })
        if (session.pos_shift_id) {
          const returnedShift = await tx.posShift.findFirst({
            where: { id: session.pos_shift_id, owner_id: user.id, status: 'locally_closed' },
            select: { id: true, opened_by_id: true },
          })
          const returned = await tx.posShift.updateMany({
            where: { id: session.pos_shift_id, owner_id: user.id, status: 'locally_closed' },
            data: { status: 'needs_review', closing_explanation: notes },
          })
          if (returnedShift && returned.count === 1) {
            await tx.notification.upsert({
              where: { id: `pos-shift-recount:${returnedShift.id}` },
              update: {
                user_id: returnedShift.opened_by_id,
                message: `Your manager returned this shift for recount. Note: ${notes}`,
                action_url: '/dashboard/city/pos/history',
              },
              create: {
                id: `pos-shift-recount:${returnedShift.id}`,
                user_id: returnedShift.opened_by_id,
                type: 'pos_shift_recount_required',
                title: 'Shift returned for recount',
                message: `Your manager returned this shift for recount. Note: ${notes}`,
                entity_type: 'pos_shift',
                entity_id: returnedShift.id,
                action_url: '/dashboard/city/pos/history',
              },
            })
          }
        }
      })
      return NextResponse.json({ success: true, status: 'rejected' })
    }

    return NextResponse.json({ error: 'Unsupported audit action.' }, { status: 400 })
  } catch (error) {
    console.error('[INVENTORY AUDIT PATCH]', error)
    const message = error instanceof Error ? error.message : 'Unable to update this audit.'
    return NextResponse.json({ error: message }, { status: error instanceof InventoryAuditConflictError ? 409 : 500 })
  }
}
