import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import { calculateCollectedCash } from '@/app/lib/branchCash'
import { getDepositProofUrl, removeDepositProof, uploadDepositProof } from '@/app/lib/depositProof'
import { notifyAssignedAreaManagers, notifyDepositConfirmers, notifyDepositParticipants } from '@/app/lib/depositNotifications'
import prisma from '@/app/lib/prisma'

async function branchUser() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return null
  const profile = await prisma.distributorProfile.findUnique({ where: { user_id: user.id }, select: { dist_level: true } })
  return profile?.dist_level === 'branch' ? user : null
}
const actor = (user: NonNullable<Awaited<ReturnType<typeof branchUser>>>) => ({ id: user.actor_id || user.id, name: user.actor_name || user.full_name })
function validDate(value: unknown) { const date = new Date(String(value || '')); return Number.isFinite(date.getTime()) ? date : null }
class DepositConfirmationConflictError extends Error {}
class DepositPeriodConflictError extends Error {}

export async function GET() {
  const user = await branchUser()
  if (!user) return NextResponse.json({ error: 'Branch access required.' }, { status: 403 })
  const deposits = await prisma.branchCashDeposit.findMany({ where: { branch_id: user.id }, orderBy: { deposited_at: 'desc' }, take: 100 })
  const who = actor(user)
  const canSubmit = !user.is_staff || user.permissions?.includes('deposit_submit') === true
  const canConfirm = !user.is_staff || user.permissions?.includes('deposit_confirm') === true
  return NextResponse.json({
    deposits: await Promise.all(deposits.map(async (row) => ({
      ...row,
      proof_storage_path: undefined,
      proof_url: await getDepositProofUrl(row.proof_storage_path),
      expected_cash_snapshot: Number(row.expected_cash_snapshot),
      deposit_amount: Number(row.deposit_amount),
      variance_amount: Number(row.variance_amount),
      can_respond: row.status === 'needs_explanation' && row.submitted_by === who.id,
    }))),
    can_submit: canSubmit,
    can_confirm: canConfirm,
  })
}

export async function POST(req: NextRequest) {
  let uploadedProof: string | null = null
  try {
    const user = await branchUser()
    if (!user) return NextResponse.json({ error: 'Branch access required.' }, { status: 403 })
    if (user.is_staff && !user.permissions?.includes('deposit_submit')) return NextResponse.json({ error: 'Deposit Submitter permission is required.' }, { status: 403 })
    const body = await req.json(), periodStart = validDate(body.period_start), periodEndInclusive = validDate(body.period_end), depositedAt = validDate(body.deposited_at)
    const amount = Number(body.deposit_amount), bankName = String(body.bank_name || '').trim(), bankReference = String(body.bank_reference || '').trim(), lastFour = String(body.bank_account_last_four || '').trim(), proofData = String(body.proof_data_url || '')
    if (!periodStart || !periodEndInclusive || !depositedAt || periodEndInclusive < periodStart || !Number.isFinite(amount) || amount < 0 || bankName.length < 2 || bankReference.length < 4 || (lastFour && !/^\d{4}$/.test(lastFour)) || !proofData) return NextResponse.json({ error: 'Enter valid deposit details and upload the deposit slip image.' }, { status: 400 })
    const periodEnd = new Date(periodEndInclusive.getTime() + 86400000)
    const who = actor(user), reference = `DEP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`, depositId = crypto.randomUUID()
    const proofPath = await uploadDepositProof(user.id, depositId, proofData)
    uploadedProof = proofPath
    const created = await prisma.$transaction(async (tx) => {
      // Serialize deposit-period claims per branch so concurrent submissions
      // cannot both pass the overlap check and freeze the same cash twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`
      const overlapping = await tx.branchCashDeposit.findFirst({
        where: {
          branch_id: user.id,
          status: { not: 'rejected' },
          period_start: { lt: periodEnd },
          period_end: { gt: periodStart },
        },
        select: { reference_number: true },
      })
      if (overlapping) {
        throw new DepositPeriodConflictError(
          `This cash period overlaps ${overlapping.reference_number}. Use the existing reconciliation or choose dates that have not been covered.`,
        )
      }
      const collected = await calculateCollectedCash(tx, user.id, periodStart, periodEnd)
      const deposit = await tx.branchCashDeposit.create({ data: { id: depositId, reference_number: reference, branch_id: user.id, period_start: periodStart, period_end: periodEnd, expected_cash_snapshot: new Prisma.Decimal(collected.total), deposit_amount: new Prisma.Decimal(amount), variance_amount: new Prisma.Decimal(amount - collected.total), bank_name: bankName, bank_account_last_four: lastFour || null, bank_reference: bankReference, deposited_at: depositedAt, proof_storage_path: proofPath, notes: String(body.notes || '').trim() || null, submitted_by: who.id, submitted_by_name_snapshot: who.name } })
      await tx.inventoryAuditEvent.create({ data: { owner_id: user.id, actor_id: who.id, actor_name_snapshot: who.name, event_type: 'cash_deposit_submitted', total_value: new Prisma.Decimal(amount), reference_type: 'branch_cash_deposit', reference_id: deposit.id, reason: `Expected collected cash ${collected.total.toFixed(2)}; deposit variance ${(amount - collected.total).toFixed(2)}`, metadata: { reference_number: reference, bank_reference: bankReference, period_start: periodStart.toISOString(), period_end: periodEnd.toISOString(), product_cash: collected.productCash, registration_cash: collected.registrationCash } } })
      return deposit
    })
    await notifyDepositConfirmers({ actorId: who.id, branchId: user.id, depositId: created.id, reference, type: 'branch_deposit_confirmation_required', title: 'Bank deposit needs confirmation', message: `${who.name} submitted ${reference}. Check the official bank record and independently confirm it.` })
    return NextResponse.json({ success: true, id: created.id, reference_number: reference }, { status: 201 })
  } catch (error) {
    await removeDepositProof(uploadedProof)
    if (error instanceof DepositPeriodConflictError) return NextResponse.json({ error: error.message }, { status: 409 })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: 'That bank reference has already been submitted.' }, { status: 409 })
    console.error('[BRANCH DEPOSIT SUBMIT]', error); return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to submit the bank deposit.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  let replacementProof: string | null = null
  let previousProof: string | null = null
  try {
    const user = await branchUser()
    if (!user) return NextResponse.json({ error: 'Branch access required.' }, { status: 403 })
    const body = await req.json(), id = String(body.id || ''), notes = String(body.notes || '').trim(), action = String(body.action || 'confirm')
    const deposit = await prisma.branchCashDeposit.findFirst({ where: { id, branch_id: user.id } })
    const who = actor(user)
    if (action === 'resubmit') {
      if (user.is_staff && !user.permissions?.includes('deposit_submit')) return NextResponse.json({ error: 'Deposit Submitter permission is required.' }, { status: 403 })
      if (!deposit || deposit.status !== 'needs_explanation') return NextResponse.json({ error: 'Returned deposit not found.' }, { status: 404 })
      if (deposit.submitted_by !== who.id) return NextResponse.json({ error: 'Only the original submitter can respond and resubmit this deposit.' }, { status: 403 })
      if (notes.length < 5) return NextResponse.json({ error: 'Explain the correction or discrepancy before resubmitting.' }, { status: 400 })
      const amount = Number(body.deposit_amount), bankReference = String(body.bank_reference || '').trim(), depositedAt = validDate(body.deposited_at), proofData = String(body.proof_data_url || '')
      if (!Number.isFinite(amount) || amount < 0 || bankReference.length < 4 || !depositedAt) return NextResponse.json({ error: 'Enter a valid deposit amount, date, bank reference, and explanation.' }, { status: 400 })
      if (proofData) replacementProof = await uploadDepositProof(user.id, `${id}-correction-${Date.now()}`, proofData)
      previousProof = deposit.proof_storage_path
      const variance = amount - Number(deposit.expected_cash_snapshot)
      const corrected = await prisma.$transaction(async (tx) => {
        const claimed = await tx.branchCashDeposit.updateMany({
          where: { id, branch_id: user.id, status: 'needs_explanation', submitted_by: who.id },
          data: {
            status: 'submitted', deposit_amount: new Prisma.Decimal(amount), variance_amount: new Prisma.Decimal(variance),
            bank_reference: bankReference, deposited_at: depositedAt, notes,
            ...(replacementProof ? { proof_storage_path: replacementProof } : {}),
            confirmed_by: null, confirmed_by_name_snapshot: null, confirmed_at: null,
            reviewed_by: null, reviewed_by_name_snapshot: null, reviewed_at: null,
          },
        })
        if (claimed.count !== 1) throw new DepositConfirmationConflictError('This returned deposit already changed. Refresh before trying again.')
        await tx.inventoryAuditEvent.create({
          data: {
            owner_id: user.id, actor_id: who.id, actor_name_snapshot: who.name,
            event_type: 'cash_deposit_corrected_resubmitted', total_value: new Prisma.Decimal(amount),
            reference_type: 'branch_cash_deposit', reference_id: id, reason: notes,
            metadata: {
              reference_number: deposit.reference_number,
              previous: { deposit_amount: Number(deposit.deposit_amount), variance_amount: Number(deposit.variance_amount), bank_reference: deposit.bank_reference, deposited_at: deposit.deposited_at.toISOString(), proof_storage_path: deposit.proof_storage_path },
              corrected: { deposit_amount: amount, variance_amount: variance, bank_reference: bankReference, deposited_at: depositedAt.toISOString(), proof_replaced: Boolean(replacementProof) },
              area_manager_note: deposit.review_notes,
            },
          },
        })
        return true
      })
      if (corrected && replacementProof && previousProof) await removeDepositProof(previousProof)
      await notifyDepositConfirmers({ actorId: who.id, branchId: user.id, depositId: id, reference: deposit.reference_number, type: 'branch_deposit_resubmitted', title: 'Corrected deposit needs confirmation', message: `${who.name} corrected and resubmitted ${deposit.reference_number}. Independently check the updated record.` })
      return NextResponse.json({ success: true })
    }

    const authorizedApprover = !user.is_staff || user.permissions?.includes('deposit_confirm') === true
    if (!authorizedApprover) return NextResponse.json({ error: 'Deposit Confirmer permission is required.' }, { status: 403 })
    if (!deposit || deposit.status !== 'submitted') return NextResponse.json({ error: 'Submitted deposit not found.' }, { status: 404 })
    if (deposit.submitted_by === who.id) return NextResponse.json({ error: 'The submitter cannot confirm the same deposit. Another authorized person must perform the check.' }, { status: 409 })
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.branchCashDeposit.updateMany({
        where: { id, branch_id: user.id, status: 'submitted' },
        data: { status: 'confirmed', confirmed_by: who.id, confirmed_by_name_snapshot: who.name, confirmed_at: new Date(), notes: notes || undefined },
      })
      if (claimed.count !== 1) throw new DepositConfirmationConflictError('This deposit was already confirmed or changed. Refresh to see its latest status.')
      await tx.inventoryAuditEvent.create({ data: { owner_id: user.id, actor_id: who.id, actor_name_snapshot: who.name, event_type: 'cash_deposit_confirmed', total_value: deposit.deposit_amount, reference_type: 'branch_cash_deposit', reference_id: id, reason: notes || 'Confirmed by authorized Operations Approver' } })
    })
    await Promise.all([
      notifyDepositParticipants({ actorId: who.id, branchId: user.id, depositId: id, reference: deposit.reference_number, submittedBy: deposit.submitted_by, type: 'branch_deposit_confirmed', title: 'Bank deposit confirmed', message: `${deposit.reference_number} was independently confirmed by ${who.name} and sent to the Area Manager.` }),
      notifyAssignedAreaManagers({ actorId: who.id, branchId: user.id, depositId: id, reference: deposit.reference_number, type: 'branch_deposit_area_review_required', title: 'Bank deposit ready for review', message: `${deposit.reference_number} was independently confirmed and is ready for Area Manager verification.` }),
    ])
    return NextResponse.json({ success: true })
  } catch (error) {
    if (replacementProof) await removeDepositProof(replacementProof)
    console.error('[BRANCH DEPOSIT CONFIRM]', error)
    const message = error instanceof Error ? error.message : 'Unable to confirm this deposit.'
    return NextResponse.json({ error: message }, { status: error instanceof DepositConfirmationConflictError ? 409 : 500 })
  }
}
