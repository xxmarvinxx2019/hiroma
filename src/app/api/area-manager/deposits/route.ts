import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { notifyDepositParticipants } from '@/app/lib/depositNotifications'
import prisma from '@/app/lib/prisma'
import { getDepositProofUrl } from '@/app/lib/depositProof'

async function manager() { const user = await getCurrentUser(); return user?.role === 'admin' && user.is_staff && user.staff_type === 'area_manager' ? user : null }
function assigned(user: NonNullable<Awaited<ReturnType<typeof manager>>>, branchId: string) { return (user.permissions || []).includes(`area_branch:${branchId}`) }
const numberRows = <T extends { expected_cash_snapshot: unknown; deposit_amount: unknown; variance_amount: unknown }>(rows: T[]) => rows.map((row) => ({ ...row, expected_cash_snapshot: Number(row.expected_cash_snapshot), deposit_amount: Number(row.deposit_amount), variance_amount: Number(row.variance_amount) }))

class DepositReviewConflictError extends Error {}

export async function GET(req: NextRequest) {
  const user = await manager(), branchId = req.nextUrl.searchParams.get('branch_id') || ''
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!assigned(user, branchId)) return NextResponse.json({ error: 'This branch is not assigned to you.' }, { status: 403 })
  const deposits = await prisma.branchCashDeposit.findMany({ where: { branch_id: branchId }, orderBy: { deposited_at: 'desc' }, take: 100 })
  return NextResponse.json({ deposits: await Promise.all(numberRows(deposits).map(async (row) => ({ ...row, proof_storage_path: undefined, proof_url: await getDepositProofUrl(row.proof_storage_path) }))) })
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await manager()
    if (!user || !user.actor_id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const body = await req.json(), id = String(body.id || ''), action = String(body.action || ''), notes = String(body.notes || '').trim()
    if (!['verify', 'reject', 'request_explanation'].includes(action) || notes.length < 5) return NextResponse.json({ error: 'Choose a valid review action and enter review notes.' }, { status: 400 })
    const deposit = await prisma.branchCashDeposit.findUnique({ where: { id }, select: { branch_id: true, status: true, submitted_by: true, confirmed_by: true, deposit_amount: true, reference_number: true } })
    if (!deposit || !assigned(user, deposit.branch_id)) return NextResponse.json({ error: 'Deposit not found in your assigned branches.' }, { status: 404 })
    if (action === 'verify' && deposit.status !== 'confirmed') return NextResponse.json({ error: 'The Branch Manager must confirm this deposit before Area Manager verification.' }, { status: 409 })
    if (['verified', 'rejected'].includes(deposit.status)) return NextResponse.json({ error: 'This deposit already has a final review.' }, { status: 409 })
    if ([deposit.submitted_by, deposit.confirmed_by].includes(user.actor_id)) return NextResponse.json({ error: 'A submitter or confirmer cannot independently review the same deposit.' }, { status: 409 })
    const status = action === 'verify' ? 'verified' : action === 'reject' ? 'rejected' : 'needs_explanation', name = user.actor_name || user.full_name
    const allowedStatuses = action === 'verify' ? ['confirmed'] : ['draft', 'submitted', 'confirmed', 'needs_explanation']

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.branchCashDeposit.updateMany({
        where: { id, status: { in: allowedStatuses } },
        data: { status, reviewed_by: user.actor_id, reviewed_by_name_snapshot: name, reviewed_at: new Date(), review_notes: notes },
      })
      if (claimed.count !== 1) throw new DepositReviewConflictError('This deposit was already reviewed or changed. Refresh to see its latest status.')
      await tx.inventoryAuditEvent.create({ data: { owner_id: deposit.branch_id, actor_id: user.actor_id, actor_name_snapshot: name, event_type: `cash_deposit_${status}`, total_value: deposit.deposit_amount, reference_type: 'branch_cash_deposit', reference_id: id, reason: notes } })
    })
    const notice = status === 'verified'
      ? { type: 'branch_deposit_verified', title: 'Bank deposit verified', message: `${deposit.reference_number} was verified by Area Manager ${name}.` }
      : status === 'rejected'
        ? { type: 'branch_deposit_rejected', title: 'Bank deposit rejected', message: `${deposit.reference_number} was rejected by Area Manager ${name}. Reason: ${notes}` }
        : { type: 'branch_deposit_explanation_required', title: 'Bank deposit returned for correction', message: `${deposit.reference_number} needs your explanation or correction. Area Manager note: ${notes}` }
    await notifyDepositParticipants({
      actorId: user.actor_id,
      branchId: deposit.branch_id,
      depositId: id,
      reference: deposit.reference_number,
      submittedBy: deposit.submitted_by,
      confirmedBy: deposit.confirmed_by,
      ...notice,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[AREA MANAGER DEPOSIT PATCH]', error)
    const message = error instanceof Error ? error.message : 'Unable to review this deposit.'
    return NextResponse.json({ error: message }, { status: error instanceof DepositReviewConflictError ? 409 : 500 })
  }
}
