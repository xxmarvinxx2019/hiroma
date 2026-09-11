import { NextRequest, NextResponse } from 'next/server'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'
import { getCurrentUser } from '@/app/lib/auth'
import { finalizePayoutFunds } from '@/app/lib/payoutFunds'
import prisma from '@/app/lib/prisma'
import { getSensitiveResellerPinFailure, isSensitiveResellerPinAccepted, verifyResellerSecurityPin } from '@/app/lib/resellerSecurityPin'

const MAX_IMPORT_ROWS = 5000
const SUCCESS_RESULTS = new Set(['successful', 'success', 'released', 'paid'])
const NON_RELEASE_RESULTS = new Set(['pending', 'failed'])

type ImportedRow = {
  batch_id?: unknown
  payout_id?: unknown
  approved_amount?: unknown
  provider?: unknown
  external_reference?: unknown
  transaction_date_time?: unknown
  result?: unknown
  notes?: unknown
}

function clean(value: unknown, max = 160) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : String(value ?? '').trim().slice(0, max)
}

function normalizedReference(value: unknown) {
  return clean(value).toLocaleUpperCase('en-PH')
}

function parseDate(value: unknown) {
  const parsed = new Date(clean(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function surnameFirst(fullName: string) {
  const parts = fullName.trim().replace(/\s+/g, ' ').split(' ')
  if (parts.length < 2) return fullName.toLocaleUpperCase('en-PH')
  return `${parts.at(-1)}, ${parts.slice(0, -1).join(' ')}`.toLocaleUpperCase('en-PH')
}

async function requireOwnerWithPin(user: Awaited<ReturnType<typeof getCurrentUser>>, pin: unknown) {
  if (!user || user.role !== 'admin' || user.is_staff) {
    return { error: 'Only the Admin owner can access full payout destinations or confirm a release.', status: 403 } as const
  }
  const verification = await verifyResellerSecurityPin(user.id, pin)
  if (!isSensitiveResellerPinAccepted(verification)) return getSensitiveResellerPinFailure(verification)
  return null
}

async function validateRows(batchId: string, inputRows: ImportedRow[]) {
  if (!batchId || !Array.isArray(inputRows) || inputRows.length < 1 || inputRows.length > MAX_IMPORT_ROWS) {
    return { rows: [], valid: false, error: `Upload between 1 and ${MAX_IMPORT_ROWS.toLocaleString()} payout rows.` }
  }
  const payoutIds = inputRows.map(row => clean(row.payout_id, 64)).filter(Boolean)
  const payouts = await prisma.payout.findMany({
    where: { id: { in: [...new Set(payoutIds)] } },
    select: { id: true, batch_id: true, status: true, amount: true, payout_date: true, external_reference: true, user: { select: { identity_document_hash: true } } },
  })
  const payoutMap = new Map(payouts.map(payout => [payout.id, payout]))
  const validationHashes = [...new Set(payouts.map(payout => payout.user.identity_document_hash).filter((value): value is string => Boolean(value)))]
  const validationLimits = validationHashes.length ? await prisma.identityAccountLimit.findMany({ where: { identity_hash: { in: validationHashes } }, select: { identity_hash: true, count: true, max_allowed: true } }) : []
  const validationLimitMap = new Map(validationLimits.map(limit => [limit.identity_hash, limit]))
  const references = inputRows.map(row => normalizedReference(row.external_reference)).filter(Boolean)
  const existingReferences = references.length ? await prisma.payout.findMany({
    where: { external_reference: { in: [...new Set(references)] } },
    select: { id: true, disbursement_provider: true, external_reference: true },
  }) : []
  const existingKeys = new Set(existingReferences.map(row => `${clean(row.disbursement_provider).toLowerCase()}|${normalizedReference(row.external_reference)}`))
  const seenPayouts = new Set<string>()
  const seenReferences = new Set<string>()
  const now = new Date()

  const rows = inputRows.map((input, index) => {
    const payoutId = clean(input.payout_id, 64)
    const rowBatch = clean(input.batch_id, 40)
    const provider = clean(input.provider, 80)
    const reference = normalizedReference(input.external_reference)
    const result = clean(input.result, 20).toLowerCase()
    const amount = Number(input.approved_amount)
    const disbursedAt = parseDate(input.transaction_date_time)
    const payout = payoutMap.get(payoutId)
    const errors: string[] = []
    if (!payout) errors.push('Unknown payout ID')
    if (seenPayouts.has(payoutId)) errors.push('Duplicate payout row')
    seenPayouts.add(payoutId)
    if (rowBatch !== batchId || payout?.batch_id !== batchId) errors.push('Wrong batch')
    if (payout && payout.status !== 'approved') errors.push(`Payout is ${payout.status}, not approved`)
    const identityHash = payout?.user.identity_document_hash
    const identityLimit = identityHash ? validationLimitMap.get(identityHash) : null
    if (identityLimit && identityLimit.count > identityLimit.max_allowed) errors.push(`Account limit exceeded (${identityLimit.count} of ${identityLimit.max_allowed})`)
    if (!Number.isFinite(amount) || !payout || Math.abs(amount - Number(payout.amount)) > 0.001) errors.push('Amount does not match approved amount')
    if (!SUCCESS_RESULTS.has(result) && !NON_RELEASE_RESULTS.has(result)) errors.push('Result must be Successful, Pending, or Failed')
    if (SUCCESS_RESULTS.has(result)) {
      if (!provider) errors.push('Payment provider is required')
      if (!reference) errors.push('External reference is required')
      if (!disbursedAt || disbursedAt > now) errors.push('Enter a valid transaction date/time that is not in the future')
      const referenceKey = `${provider.toLowerCase()}|${reference}`
      if (seenReferences.has(referenceKey) || existingKeys.has(referenceKey)) errors.push('Duplicate provider/reference')
      seenReferences.add(referenceKey)
    }
    return {
      row_number: index + 2,
      payout_id: payoutId,
      batch_id: rowBatch,
      approved_amount: amount,
      provider,
      external_reference: reference,
      transaction_date_time: disbursedAt?.toISOString() || null,
      result,
      notes: clean(input.notes, 500),
      errors,
      ready: errors.length === 0 && SUCCESS_RESULTS.has(result),
    }
  })
  return { rows, valid: rows.every(row => row.errors.length === 0), error: null }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const action = clean(body.action, 20)

    if (action === 'list') {
      const groups = await prisma.payout.groupBy({
        by: ['batch_id'], where: { status: 'approved', batch_id: { not: null } },
        _count: { id: true }, _sum: { amount: true }, orderBy: { batch_id: 'asc' },
      })
      return NextResponse.json({ batches: groups.map(group => ({ batch_id: group.batch_id, count: group._count.id, amount: Number(group._sum.amount || 0) })) })
    }

    if (action === 'export') {
      const denied = await requireOwnerWithPin(user, body.security_pin)
      if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })
      const batchId = clean(body.batch_id, 40)
      const payouts = await prisma.payout.findMany({
        where: { batch_id: batchId, status: 'approved' },
        select: {
          id: true, batch_id: true, transaction_number: true, amount: true, payment_method: true,
          payment_reference: true, payout_date: true,
          user: { select: { id: true, member_id: true, username: true, full_name: true, identity_document_hash: true } },
        },
      })
      if (!payouts.length) return NextResponse.json({ error: 'No approved payouts found in this batch.' }, { status: 404 })
      const identityHashes = [...new Set(payouts.map(payout => payout.user.identity_document_hash).filter((value): value is string => Boolean(value)))]
      const [identityLimits, relatedAccounts] = await Promise.all([
        prisma.identityAccountLimit.findMany({ where: { identity_hash: { in: identityHashes } }, select: { identity_hash: true, count: true, max_allowed: true } }),
        prisma.user.findMany({ where: { identity_document_hash: { in: identityHashes }, role: 'reseller', status: 'active' }, select: { id: true, username: true, identity_document_hash: true }, orderBy: { username: 'asc' } }),
      ])
      const limitMap = new Map(identityLimits.map(limit => [limit.identity_hash, limit]))
      const accountSequence = new Map<string, { position: number; count: number }>()
      for (const hash of identityHashes) {
        const accounts = relatedAccounts.filter(account => account.identity_document_hash === hash)
        accounts.forEach((account, index) => accountSequence.set(account.id, { position: index + 1, count: accounts.length }))
      }
      const rows = payouts.sort((a, b) => surnameFirst(a.user.full_name).localeCompare(surnameFirst(b.user.full_name)) || a.user.username.localeCompare(b.user.username)).map(payout => {
        const hash = payout.user.identity_document_hash
        const sequence = accountSequence.get(payout.user.id)
        const limit = hash ? limitMap.get(hash) : null
        const accountCount = limit?.count ?? sequence?.count ?? 0
        const accountLimit = limit?.max_allowed ?? 7
        return {
          batch_id: payout.batch_id,
          payout_id: payout.id,
          internal_transaction_number: payout.transaction_number,
          account_holder: surnameFirst(payout.user.full_name),
          username: payout.user.username,
          member_id: payout.user.member_id,
          account_sequence: sequence ? `${String(sequence.position).padStart(2, '0')} of ${String(accountCount).padStart(2, '0')}` : 'REVIEW',
          account_limit: accountLimit,
          compliance_check: !hash ? 'REVIEW: no verified identity link' : accountCount > accountLimit ? `BLOCKED: more than ${accountLimit} accounts` : 'OK',
          payment_method: payout.payment_method,
          full_destination: payout.payment_reference,
          approved_amount: Number(payout.amount),
          scheduled_payout_date: payout.payout_date?.toISOString() || '',
          provider: '', external_reference: '', transaction_date_time: '', result: '', notes: '',
        }
      })
      await createRequiredAuditLog(prisma, { user_id: user.id, user_name: user.full_name || user.username, user_role: 'admin', activity_type: 'payout_maker_file_exported', category: 'payout', description: `Exported secured maker file for ${batchId}.`, metadata: { batch_id: batchId, row_count: rows.length }, ...getClientInfo(req), risk_level: 'high', status: 'completed' })
      return NextResponse.json({ batch_id: batchId, rows }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
    }

    if (action === 'preview') {
      const validation = await validateRows(clean(body.batch_id, 40), body.rows)
      return NextResponse.json(validation, { status: validation.error ? 400 : 200 })
    }

    if (action === 'commit') {
      const denied = await requireOwnerWithPin(user, body.security_pin)
      if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })
      const batchId = clean(body.batch_id, 40)
      const validation = await validateRows(batchId, body.rows)
      if (!validation.valid || validation.error) return NextResponse.json({ error: validation.error || 'Resolve every validation error before confirming.', ...validation }, { status: 409 })
      const readyRows = validation.rows.filter(row => row.ready)
      const released = await prisma.$transaction(async tx => {
        let count = 0
        for (const row of readyRows) {
          const payout = await tx.payout.findFirst({ where: { id: row.payout_id, batch_id: batchId, status: 'approved' }, select: { id: true, user_id: true, amount: true, transaction_number: true } })
          if (!payout || Number(payout.amount) !== row.approved_amount) throw new Error('Payout changed while the batch was being released.')
          await createRequiredAuditLog(tx, {
            user_id: payout.user_id, user_name: 'Hiroma payout release', user_role: 'system',
            activity_type: 'payout_released', category: 'payout', description: `Released externally verified payout ${payout.id}.`,
            metadata: { payout_id: payout.id, reseller_id: payout.user_id, amount: Number(payout.amount), transaction_number: payout.transaction_number, actor_type: 'system', released_by: user.id, provider: row.provider, external_reference: row.external_reference, batch_id: batchId },
            ...getClientInfo(req), risk_level: 'high', status: 'completed',
          })
          const claimed = await tx.payout.updateMany({ where: { id: payout.id, status: 'approved' }, data: { status: 'released', disbursement_provider: row.provider, external_reference: row.external_reference, disbursed_amount: row.approved_amount, disbursed_at: new Date(row.transaction_date_time!), released_by: user.id } })
          if (claimed.count !== 1) throw new Error('Payout changed while the batch was being released.')
          await finalizePayoutFunds(tx, payout.id, payout.user_id, Number(payout.amount))
          await tx.notification.create({ data: { user_id: payout.user_id, type: 'payout_released', title: 'Payout released', message: `Your payout of ₱${Number(payout.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })} was released through ${row.provider}. Reference: ${row.external_reference}.`, amount: payout.amount, entity_type: 'payout', entity_id: payout.id, action_url: `/dashboard/reseller/payouts/${payout.id}` } })
          count += 1
        }
        return count
      })
      return NextResponse.json({ success: true, released, unchanged: validation.rows.length - readyRows.length })
    }
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
  } catch (error) {
    console.error('[PAYOUT BATCH ERROR]', error)
    const duplicate = error instanceof Error && /unique|duplicate/i.test(error.message)
    return NextResponse.json({ error: duplicate ? 'A bank/GCash reference has already been used.' : 'Unable to process the payout batch safely.' }, { status: duplicate ? 409 : 500 })
  }
}
